import type { WebSocket } from "ws";

// WebSocket client with session data
export interface WSClient extends WebSocket {
  sessionId?: string;
  isAlive?: boolean;
}

// Chat stored in memory
export interface Chat {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  cwd?: string; // diretório de trabalho do chat (para reabrir nele)
}

// Message stored in memory
export interface ChatMessage {
  id: string;
  chatId: string;
  role: "user" | "assistant" | "thinking";
  content: string;
  timestamp: string;
  images?: string[]; // URLs /uploads/... das imagens coladas (quando houver)
}

// WebSocket incoming messages
export type EffortLevel = "low" | "medium" | "high" | "xhigh";

export interface WSChatMessage {
  type: "chat";
  content: string;
  chatId: string;
  model?: string;
  cwd?: string;
  effort?: EffortLevel; // nível de raciocínio (omitido = default do SDK)
  enhancedFrom?: string; // rascunho original quando a mensagem veio do ✨ (p/ aprender)
  images?: { media_type: string; data: string }[];
}

export interface WSSubscribeMessage {
  type: "subscribe";
  chatId: string;
}

export interface WSStopMessage {
  type: "stop";
  chatId: string;
}

export interface WSApprovalMessage {
  type: "approval";
  chatId: string;
  id: string;
  approved: boolean;
}

// Comandos que falam com o backend (ex: /compact aciona a compactação do SDK)
export interface WSCommandMessage {
  type: "command";
  chatId: string;
  name: "compact";
}

export type IncomingWSMessage =
  | WSChatMessage
  | WSSubscribeMessage
  | WSStopMessage
  | WSApprovalMessage
  | WSCommandMessage;
