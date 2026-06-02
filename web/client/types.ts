// Tipos compartilhados do client (web).

export interface Chat {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  cwd?: string; // diretório de trabalho do chat
}

export interface Message {
  id: string;
  role: "user" | "assistant" | "tool_use" | "thinking" | "subagent" | "tester";
  content: string;
  timestamp: string;
  toolName?: string;
  toolInput?: Record<string, any>;
  images?: string[]; // URLs (/uploads/...) ou data: das imagens da mensagem
  commands?: string[]; // (tester) comandos Bash executados
  done?: boolean; // (tester) terminou de rodar
  success?: boolean; // (tester) resultado final
}
