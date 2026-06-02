// Wrapper tipado de fetch para a REST API (/api/*).
// MOVER, não reescrever: usa exatamente os MESMOS endpoints/params/shapes
// que o App.tsx e o ChatWindow.tsx usam hoje. Em caso de erro, cada função
// retorna o shape vazio coerente (mesmo fallback do código atual).
import type { Chat, Message } from "../types";

const API_BASE = "/api";

// projeto recente (tela inicial): mesmo shape que o App monta hoje
export interface RecentProject {
  path: string;
  name: string;
  lastOpenedAt: string;
  branch: string;
}

// resultado do git diff (read-only) usado pelo GitPanel
export interface GitDiff {
  diff: string;
  status: string;
  numstat: string;
}

// navegador de diretórios ("Abrir projeto")
export interface BrowseResult {
  path: string;
  parent: string;
  dirs: string[];
}

// info do projeto (empty state)
export interface ProjectInfo {
  cwd: string;
  branch: string;
  lastCommit: string;
}

// saída do enhancer (✨)
export interface EnhanceResult {
  improvedPrompt?: string;
  error?: string;
  [key: string]: any;
}

// GET /api/chats -> lista de chats
export async function getChats(): Promise<Chat[]> {
  try {
    const res = await fetch(`${API_BASE}/chats`);
    return await res.json();
  } catch (error) {
    console.error("Failed to fetch chats:", error);
    return [];
  }
}

// POST /api/chats -> cria chat (title opcional)
export async function createChat(title?: string): Promise<Chat | null> {
  try {
    const res = await fetch(`${API_BASE}/chats`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: title !== undefined ? JSON.stringify({ title }) : undefined,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (error) {
    console.error("Failed to create chat:", error);
    return null;
  }
}

// GET /api/chats/:id -> um chat
export async function getChat(id: string): Promise<Chat | null> {
  try {
    const res = await fetch(`${API_BASE}/chats/${id}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (error) {
    console.error("Failed to fetch chat:", error);
    return null;
  }
}

// PATCH /api/chats/:id -> renomeia
export async function renameChat(id: string, title: string): Promise<Chat | null> {
  try {
    const res = await fetch(`${API_BASE}/chats/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (error) {
    console.error("Failed to rename chat:", error);
    return null;
  }
}

// DELETE /api/chats/:id -> arquiva
export async function deleteChat(id: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/chats/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return true;
  } catch (error) {
    console.error("Failed to delete chat:", error);
    return false;
  }
}

// GET /api/chats/:id/messages -> histórico de mensagens
export async function getMessages(id: string): Promise<Message[]> {
  try {
    const res = await fetch(`${API_BASE}/chats/${id}/messages`);
    return await res.json();
  } catch (error) {
    console.error("Failed to fetch messages:", error);
    return [];
  }
}

// GET /api/git/diff?cwd=... -> diff/status/numstat do diretório da sessão
export async function getGitDiff(cwd: string): Promise<GitDiff> {
  try {
    const q = cwd.trim() ? `?cwd=${encodeURIComponent(cwd.trim())}` : "";
    const res = await fetch(`${API_BASE}/git/diff${q}`);
    const data = await res.json();
    return { diff: data.diff || "", status: data.status || "", numstat: data.numstat || "" };
  } catch (error) {
    console.error("Failed to fetch git diff:", error);
    return { diff: "", status: "", numstat: "" };
  }
}

// POST /api/enhance -> reescreve o rascunho num prompt melhor (mode omitido = auto)
export async function enhance(text: string): Promise<EnhanceResult> {
  try {
    const res = await fetch(`${API_BASE}/enhance`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    // checa res.ok antes do .json(): respostas não-JSON (413, proxy) não quebram o parser
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { error: `Enhancer falhou (${res.status})${detail ? `: ${detail.slice(0, 120)}` : ""}` };
    }
    return await res.json();
  } catch {
    return { error: "Falha ao chamar o enhancer." };
  }
}

// GET /api/project/info?cwd=... -> cwd, branch, última modificação
export async function getProjectInfo(cwd: string): Promise<ProjectInfo> {
  try {
    const q = cwd.trim() ? `?cwd=${encodeURIComponent(cwd.trim())}` : "";
    const res = await fetch(`${API_BASE}/project/info${q}`);
    const data = await res.json();
    return { cwd: data.cwd || "", branch: data.branch || "", lastCommit: data.lastCommit || "" };
  } catch (error) {
    console.error("Failed to fetch project info:", error);
    return { cwd: "", branch: "", lastCommit: "" };
  }
}

// GET /api/browse?path=... -> subdiretórios para o navegador "Abrir projeto"
export async function browse(path?: string): Promise<BrowseResult> {
  try {
    const q = path ? `?path=${encodeURIComponent(path)}` : "";
    const res = await fetch(`${API_BASE}/browse${q}`);
    const data = await res.json();
    return { path: data.path || "", parent: data.parent || "", dirs: data.dirs || [] };
  } catch (error) {
    console.error("Failed to browse:", error);
    return { path: "", parent: "", dirs: [] };
  }
}

// GET /api/projects -> projetos recentes (tela inicial)
export async function getProjects(): Promise<{ projects: RecentProject[] }> {
  try {
    const res = await fetch(`${API_BASE}/projects`);
    const data = await res.json();
    return { projects: data.projects || [] };
  } catch (error) {
    console.error("Failed to fetch projects:", error);
    return { projects: [] };
  }
}

// GET /api/files?cwd=... -> arquivos rastreados (autocomplete @)
export async function getFiles(cwd: string): Promise<string[]> {
  try {
    const q = cwd.trim() ? `?cwd=${encodeURIComponent(cwd.trim())}` : "";
    const res = await fetch(`${API_BASE}/files${q}`);
    const data = await res.json();
    return data.files || [];
  } catch {
    return [];
  }
}
