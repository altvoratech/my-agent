// .env é carregado via `tsx --env-file=.env` no npm script (sem dotenv).
import express from "express";
import cors from "cors";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);
import { createServer } from "http";
import { statSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { WebSocketServer, WebSocket } from "ws";
import path from "path";
import { fileURLToPath } from "url";
import type { WSClient, IncomingWSMessage } from "./types.js";
import { chatStore } from "./chat-store.js";
import { Session } from "./session.js";
import { UPLOADS_DIR } from "./uploads.js";
import { enhancePrompt } from "./enhance.js";
import { logEvents } from "../../src/core/logger.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3001;

// Express app
const app = express();
app.use(cors());
app.use(express.json());

// Serve static files from client directory
app.use("/client", express.static(path.join(__dirname, "../client")));

// Serve as imagens coladas no chat (web/uploads)
app.use("/uploads", express.static(UPLOADS_DIR));

// Serve index.html at root
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../client/index.html"));
});

// Session management
const sessions: Map<string, Session> = new Map();

// O cwd vai direto pro spawn do claude no Agent SDK, que exige um DIRETÓRIO
// existente. Se vier um arquivo, usamos a pasta dele; se não existir, recusamos
// com mensagem clara (senão o SDK só diz "exists but failed to launch").
function resolveCwd(cwd?: string): string | undefined {
  if (!cwd) return undefined;
  let st;
  try {
    st = statSync(cwd);
  } catch {
    throw new Error(`Diretório não encontrado: ${cwd}`);
  }
  if (st.isDirectory()) return cwd;
  if (st.isFile()) return path.dirname(cwd);
  throw new Error(`Caminho inválido como diretório de trabalho: ${cwd}`);
}

function getOrCreateSession(chatId: string, model?: string, cwd?: string, effort?: string): Session {
  let session = sessions.get(chatId);
  // trocou de modelo, cwd ou effort -> recria a sessão (novo contexto; histórico fica no SQLite)
  const cwdChanged = cwd && session && session.cwd !== cwd;
  const modelChanged = model && session && session.model !== model;
  const effortChanged = session && (session.effort ?? undefined) !== (effort ?? undefined);
  if (session && (modelChanged || cwdChanged || effortChanged)) {
    session.close();
    sessions.delete(chatId);
    session = undefined;
  }
  if (!session) {
    // injeta o histórico (do SQLite) para o agente manter o contexto ao (re)criar
    session = new Session(chatId, model, chatStore.getMessages(chatId), cwd, effort);
    sessions.set(chatId, session);
  }
  return session;
}

// REST API: Get all chats
app.get("/api/chats", (req, res) => {
  const chats = chatStore.getAllChats();
  res.json(chats);
});

// REST API: Create new chat
app.post("/api/chats", (req, res) => {
  const chat = chatStore.createChat(req.body?.title);
  res.status(201).json(chat);
});

// REST API: Get single chat
app.get("/api/chats/:id", (req, res) => {
  const chat = chatStore.getChat(req.params.id);
  if (!chat) {
    return res.status(404).json({ error: "Chat not found" });
  }
  res.json(chat);
});

// REST API: Rename chat
app.patch("/api/chats/:id", (req, res) => {
  const title = String((req.body?.title ?? "")).trim();
  if (!title) return res.status(400).json({ error: "title obrigatório" });
  const chat = chatStore.updateChatTitle(req.params.id, title.slice(0, 80));
  if (!chat) return res.status(404).json({ error: "Chat not found" });
  res.json(chat);
});

// REST API: Delete chat
app.delete("/api/chats/:id", (req, res) => {
  const deleted = chatStore.deleteChat(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: "Chat not found" });
  }
  const session = sessions.get(req.params.id);
  if (session) {
    session.close();
    sessions.delete(req.params.id);
  }
  res.json({ success: true });
});

// REST API: Get chat messages
app.get("/api/chats/:id/messages", (req, res) => {
  const messages = chatStore.getMessages(req.params.id);
  res.json(messages);
});

// cwd para os endpoints read-only: ?cwd=... (segue o diretório da sessão).
// Valida que é um diretório existente; arquivo -> pasta; inválido -> process.cwd().
function cwdFromQuery(req: express.Request): string {
  const raw = typeof req.query.cwd === "string" ? req.query.cwd.trim() : "";
  if (!raw) return process.cwd();
  try {
    const st = statSync(raw);
    if (st.isDirectory()) return raw;
    if (st.isFile()) return path.dirname(raw);
  } catch {
    /* inexistente -> fallback */
  }
  return process.cwd();
}

// Git diff do diretório da sessão (read-only). --relative limita ao cwd.
app.get("/api/git/diff", async (req, res) => {
  const cwd = cwdFromQuery(req);
  try {
    const [diff, status, numstat] = await Promise.all([
      execFileP("git", ["diff", "--relative", "--", "."], { cwd, maxBuffer: 8e6 }),
      execFileP("git", ["status", "--porcelain", "--", "."], { cwd, maxBuffer: 1e6 }),
      // contagem +/- por arquivo (inclui modificados rastreados)
      execFileP("git", ["diff", "--numstat", "--relative", "--", "."], { cwd, maxBuffer: 1e6 }),
    ]);
    res.json({ diff: diff.stdout, status: status.stdout, numstat: numstat.stdout });
  } catch (e) {
    res.json({ diff: "", status: "", numstat: "", error: (e as Error).message });
  }
});

// Prompt enhancer (✨): reescreve o rascunho do usuário num prompt melhor para o my-agent.
app.post("/api/enhance", async (req, res) => {
  const text = String(req.body?.text ?? "").trim();
  if (!text) return res.status(400).json({ error: "texto vazio" });
  try {
    // few-shot: últimos pares aprovados (rascunho -> enviado) para o enhancer evoluir
    const examples = chatStore.recentPromptExamples(5);
    const out = await enhancePrompt(text, examples);
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// Info do projeto para o empty state (cwd, branch, última modificação do repo).
app.get("/api/project/info", async (req, res) => {
  const cwd = cwdFromQuery(req);
  try {
    const [branch, lastCommit] = await Promise.all([
      execFileP("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd }).then((r) => r.stdout.trim()).catch(() => ""),
      execFileP("git", ["log", "-1", "--format=%cr"], { cwd }).then((r) => r.stdout.trim()).catch(() => ""),
    ]);
    res.json({ cwd, branch, lastCommit });
  } catch (e) {
    res.json({ cwd, branch: "", lastCommit: "", error: (e as Error).message });
  }
});

// Descoberta de diretórios (navegador do "Abrir projeto"). Lista os subdiretórios
// de `path`; se o caminho for parcial/inexistente, lista os do pai (pra filtrar
// enquanto o usuário digita). Esconde dot-dirs. Local/single-user: leitura de dir ok.
app.get("/api/browse", (req, res) => {
  const raw = typeof req.query.path === "string" && req.query.path.trim() ? req.query.path.trim() : homedir();
  let dir = raw;
  try {
    const st = statSync(dir);
    if (st.isFile()) dir = path.dirname(dir);
    else if (!st.isDirectory()) dir = homedir();
  } catch {
    // caminho parcial (ainda digitando) -> tenta o diretório pai
    const parent = path.dirname(dir);
    try {
      dir = statSync(parent).isDirectory() ? parent : homedir();
    } catch {
      dir = homedir();
    }
  }
  try {
    const dirs = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b));
    res.json({ path: dir, parent: path.dirname(dir), dirs });
  } catch (e) {
    res.json({ path: dir, parent: path.dirname(dir), dirs: [], error: (e as Error).message });
  }
});

// Projetos recentes (tela inicial): diretórios já usados + nome (basename) + branch.
app.get("/api/projects", async (_req, res) => {
  const projects = chatStore.recentProjects(12);
  const withMeta = await Promise.all(
    projects.map(async (p) => {
      const branch = await execFileP("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: p.path })
        .then((r) => r.stdout.trim())
        .catch(() => "");
      return { path: p.path, name: path.basename(p.path) || p.path, lastOpenedAt: p.lastOpenedAt, branch };
    }),
  );
  res.json({ projects: withMeta });
});

// Lista os arquivos rastreados do projeto (para o autocomplete @). git ls-files
// já respeita o .gitignore (não traz node_modules, .env, etc).
app.get("/api/files", async (req, res) => {
  try {
    const { stdout } = await execFileP("git", ["ls-files"], { cwd: cwdFromQuery(req), maxBuffer: 8e6 });
    res.json({ files: stdout.split("\n").filter(Boolean) });
  } catch (e) {
    res.json({ files: [], error: (e as Error).message });
  }
});

// Create HTTP server
const server = createServer(app);

// WebSocket server
const wss = new WebSocketServer({ server, path: "/ws" });

// Repassa eventos internos do logger (guard/prefetch) para TODOS os clients.
// Tudo roda no mesmo processo, então o bus em memória captura guardião + hooks.
// (broadcast global: ok p/ uso local single-user; correlação por chat fica p/ depois)
logEvents.on("log", (record: any) => {
  let msg: any = null;
  if (record.event === "guard.deny") {
    msg = { type: "guard", tool: record.tool, reason: record.reason };
  } else if (record.event === "guardian.prefetch") {
    msg = { type: "prefetch", hits: record.hits, sources: record.sources };
  }
  if (!msg) return;
  const str = JSON.stringify(msg);
  wss.clients.forEach((c) => {
    if (c.readyState === c.OPEN) c.send(str);
  });
});

wss.on("connection", (ws: WSClient) => {
  console.log("WebSocket client connected");
  ws.isAlive = true;

  ws.send(JSON.stringify({ type: "connected", message: "Connected to chat server" }));

  ws.on("pong", () => {
    ws.isAlive = true;
  });

  ws.on("message", (data) => {
    try {
      const message: IncomingWSMessage = JSON.parse(data.toString());

      switch (message.type) {
        case "subscribe": {
          const session = getOrCreateSession(message.chatId);
          session.subscribe(ws);
          console.log(`Client subscribed to chat ${message.chatId}`);

          // Send existing messages
          const messages = chatStore.getMessages(message.chatId);
          ws.send(JSON.stringify({
            type: "history",
            messages,
            chatId: message.chatId,
          }));
          break;
        }

        case "chat": {
          let safeCwd: string | undefined;
          try {
            safeCwd = resolveCwd(message.cwd);
          } catch (e) {
            ws.send(JSON.stringify({ type: "error", error: (e as Error).message }));
            break;
          }
          const session = getOrCreateSession(message.chatId, message.model, safeCwd, message.effort);
          session.subscribe(ws);
          try {
            // saveImages (em sendMessage) pode lançar erro descritivo (tipo/tamanho/IO);
            // propaga a mensagem REAL em vez de cair no "Invalid message format" genérico.
            session.sendMessage(message.content, message.images);
          } catch (e) {
            ws.send(JSON.stringify({ type: "error", error: (e as Error).message }));
            break;
          }
          // se a mensagem veio do ✨, registra o par (rascunho -> enviado) p/ o enhancer aprender
          if (message.enhancedFrom) chatStore.addPromptExample(message.enhancedFrom, message.content);
          // registra o diretório como projeto recente (para a tela inicial)
          chatStore.touchProject(safeCwd ?? process.cwd());
          // guarda o diretório no próprio chat (para reabrir nele depois)
          chatStore.setChatCwd(message.chatId, safeCwd ?? process.cwd());
          break;
        }

        case "stop": {
          const session = sessions.get(message.chatId);
          if (session) session.stop();
          break;
        }

        case "approval": {
          const session = sessions.get(message.chatId);
          if (session) session.respondApproval(message.id, message.approved);
          break;
        }

        case "command": {
          const session = sessions.get(message.chatId);
          if (session) session.runCommand(message.name);
          break;
        }

        default:
          console.warn("Unknown message type:", (message as any).type);
      }
    } catch (error) {
      console.error("Error handling WebSocket message:", error);
      ws.send(JSON.stringify({ type: "error", error: "Invalid message format" }));
    }
  });

  ws.on("close", () => {
    console.log("WebSocket client disconnected");
    // Unsubscribe from all sessions
    for (const session of sessions.values()) {
      session.unsubscribe(ws);
    }
  });
});

// Heartbeat to detect dead connections
const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    const client = ws as WSClient;
    if (client.isAlive === false) {
      return client.terminate();
    }
    client.isAlive = false;
    client.ping();
  });
}, 30000);

wss.on("close", () => {
  clearInterval(heartbeat);
});

// Start server
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`WebSocket endpoint available at ws://localhost:${PORT}/ws`);
  console.log(`Visit http://localhost:${PORT} to view the chat interface`);
});
