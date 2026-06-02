// Persistência das conversas em SQLite local (better-sqlite3). Mesma interface
// do store em memória do demo — server.ts/session.ts não percebem a troca.
// Banco em data/chat.db (relativo ao cwd = raiz, de onde o web:server roda).
import { v4 as uuidv4 } from "uuid";
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Chat, ChatMessage } from "./types.js";

const DB_PATH = process.env.CHAT_DB ?? "data/chat.db";
mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL"); // melhor concorrência leitura/escrita
db.pragma("foreign_keys = ON");
db.exec(`
  CREATE TABLE IF NOT EXISTS chats (
    id        TEXT PRIMARY KEY,
    title     TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS messages (
    id        TEXT PRIMARY KEY,
    chatId    TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    role      TEXT NOT NULL,
    content   TEXT NOT NULL,
    timestamp TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chatId, timestamp);

  -- Exemplos para o prompt enhancer "evoluir": pares (rascunho -> prompt enviado)
  -- que o usuário aprovou ao enviar. Injetados como few-shot nas próximas melhorias.
  CREATE TABLE IF NOT EXISTS prompt_examples (
    id        TEXT PRIMARY KEY,
    original  TEXT NOT NULL,
    final     TEXT NOT NULL,
    createdAt TEXT NOT NULL
  );

  -- Projetos recentes: diretórios em que o agente já trabalhou (para a tela inicial).
  CREATE TABLE IF NOT EXISTS recent_projects (
    path         TEXT PRIMARY KEY,
    lastOpenedAt TEXT NOT NULL
  );
`);

// Migração: coluna `images` (JSON com as URLs /uploads/...). Bancos antigos não têm.
const messageCols = db.prepare("PRAGMA table_info(messages)").all() as { name: string }[];
if (!messageCols.some((c) => c.name === "images")) {
  db.exec("ALTER TABLE messages ADD COLUMN images TEXT");
}

// Migração: coluna `cwd` no chat (diretório de trabalho daquele chat).
const chatCols = db.prepare("PRAGMA table_info(chats)").all() as { name: string }[];
if (!chatCols.some((c) => c.name === "cwd")) {
  db.exec("ALTER TABLE chats ADD COLUMN cwd TEXT");
}

class ChatStore {
  private insertChat = db.prepare(
    "INSERT INTO chats (id, title, createdAt, updatedAt) VALUES (?, ?, ?, ?)",
  );
  private selectChat = db.prepare("SELECT * FROM chats WHERE id = ?");
  private selectAllChats = db.prepare("SELECT * FROM chats ORDER BY updatedAt DESC");
  private touchChat = db.prepare("UPDATE chats SET title = ?, updatedAt = ? WHERE id = ?");
  private setChatCwdStmt = db.prepare("UPDATE chats SET cwd = ? WHERE id = ?");
  private removeChat = db.prepare("DELETE FROM chats WHERE id = ?");
  private insertMessage = db.prepare(
    "INSERT INTO messages (id, chatId, role, content, images, timestamp) VALUES (?, ?, ?, ?, ?, ?)",
  );
  // rowid como desempate: garante ordem de inserção quando timestamps empatam
  // (ex: bloco de raciocínio e texto persistidos no mesmo milissegundo).
  private selectMessages = db.prepare("SELECT * FROM messages WHERE chatId = ? ORDER BY timestamp ASC, rowid ASC");
  private insertExample = db.prepare(
    "INSERT INTO prompt_examples (id, original, final, createdAt) VALUES (?, ?, ?, ?)",
  );
  private selectRecentExamples = db.prepare(
    "SELECT original, final FROM prompt_examples ORDER BY createdAt DESC LIMIT ?",
  );
  private upsertProject = db.prepare(
    "INSERT INTO recent_projects (path, lastOpenedAt) VALUES (?, ?) ON CONFLICT(path) DO UPDATE SET lastOpenedAt = excluded.lastOpenedAt",
  );
  private selectRecentProjects = db.prepare(
    "SELECT path, lastOpenedAt FROM recent_projects ORDER BY lastOpenedAt DESC LIMIT ?",
  );

  createChat(title?: string): Chat {
    const now = new Date().toISOString();
    const chat: Chat = { id: uuidv4(), title: title || "New Chat", createdAt: now, updatedAt: now };
    this.insertChat.run(chat.id, chat.title, chat.createdAt, chat.updatedAt);
    return chat;
  }

  getChat(id: string): Chat | undefined {
    return this.selectChat.get(id) as Chat | undefined;
  }

  getAllChats(): Chat[] {
    return this.selectAllChats.all() as Chat[];
  }

  updateChatTitle(id: string, title: string): Chat | undefined {
    const chat = this.getChat(id);
    if (!chat) return undefined;
    const updatedAt = new Date().toISOString();
    this.touchChat.run(title, updatedAt, id);
    return { ...chat, title, updatedAt };
  }

  deleteChat(id: string): boolean {
    return this.removeChat.run(id).changes > 0; // CASCADE remove as mensagens
  }

  addMessage(chatId: string, message: Omit<ChatMessage, "id" | "chatId" | "timestamp">): ChatMessage {
    const chat = this.getChat(chatId);
    if (!chat) throw new Error(`Chat ${chatId} not found`);

    const newMessage: ChatMessage = {
      id: uuidv4(),
      chatId,
      timestamp: new Date().toISOString(),
      ...message,
    };
    const imagesJson = newMessage.images?.length ? JSON.stringify(newMessage.images) : null;
    this.insertMessage.run(newMessage.id, chatId, newMessage.role, newMessage.content, imagesJson, newMessage.timestamp);

    // título automático a partir da 1ª mensagem do usuário (se ainda "New Chat")
    const title =
      chat.title === "New Chat" && message.role === "user"
        ? message.content.slice(0, 50) + (message.content.length > 50 ? "..." : "")
        : chat.title;
    this.touchChat.run(title, newMessage.timestamp, chatId);

    return newMessage;
  }

  getMessages(chatId: string): ChatMessage[] {
    return (this.selectMessages.all(chatId) as any[]).map((r) => ({
      ...r,
      images: r.images ? (JSON.parse(r.images) as string[]) : undefined,
    }));
  }

  // grava um par aprovado (rascunho -> prompt final enviado) para o enhancer aprender
  addPromptExample(original: string, final: string) {
    const o = original.trim();
    const f = final.trim();
    if (!o || !f || o === f) return; // sem sinal de aprendizado
    this.insertExample.run(uuidv4(), o, f, new Date().toISOString());
  }

  // últimos N pares aprovados (mais recentes primeiro) para injetar como few-shot
  recentPromptExamples(limit = 5): { original: string; final: string }[] {
    return this.selectRecentExamples.all(limit) as { original: string; final: string }[];
  }

  // guarda o diretório de trabalho do chat (para reabrir nele)
  setChatCwd(chatId: string, cwd: string) {
    if (cwd) this.setChatCwdStmt.run(cwd, chatId);
  }

  // registra/atualiza um diretório como projeto recente
  touchProject(path: string) {
    if (!path) return;
    this.upsertProject.run(path, new Date().toISOString());
  }

  // projetos recentes (mais recentes primeiro)
  recentProjects(limit = 10): { path: string; lastOpenedAt: string }[] {
    return this.selectRecentProjects.all(limit) as { path: string; lastOpenedAt: string }[];
  }
}

export const chatStore = new ChatStore();
