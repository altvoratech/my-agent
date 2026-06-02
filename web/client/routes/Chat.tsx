import { MODELS } from "../components/chat/constants";
import type { useAgentSocket } from "../hooks/useAgentSocket";
import { ChatHeader } from "../components/chat/ChatHeader";
import { MessageList } from "../components/chat/MessageList";
import { Composer } from "../components/chat/Composer";

interface ChatProps {
  chatId: string;
  model: string;
  effort: string;
  cwd: string;
  onModelChange: (model: string) => void;
  onEffortChange: (e: string) => void;
  onCwdChange: (cwd: string) => void;
  socket: ReturnType<typeof useAgentSocket>; // retorno do useAgentSocket (socket + estado do streaming)
  files: string[]; // lista de arquivos do projeto (autocomplete @)
  onNewChat: () => void;
  onOpenPanel: (tab: "tools" | "tasks" | "git") => void;
  onOpenProject?: (path: string) => void;
}

// Tela do chat: compõe header (pickers + medidor de contexto) + lista de mensagens + composer,
// ligando cada peça aos campos do socket (useAgentSocket).
export function Chat({
  chatId,
  model,
  effort,
  cwd,
  onModelChange,
  onEffortChange,
  onCwdChange,
  socket,
  files,
  onNewChat,
  onOpenPanel,
}: ChatProps) {
  const modelLabel = MODELS.find((m) => m.id === model)?.label ?? model;

  return (
    <div className="flex-1 flex flex-col bg-white">
      <ChatHeader
        model={model}
        cwd={cwd}
        isConnected={socket.isConnected}
        lastResult={socket.lastResult}
      />
      <MessageList
        messages={socket.messages}
        isLoading={socket.isLoading}
        agentStatus={socket.agentStatus}
        modelLabel={modelLabel}
      />
      <Composer
        onSend={socket.sendMessage}
        onStop={socket.stop}
        onTest={socket.runTest}
        onCompact={socket.compact}
        onNewChat={onNewChat}
        onOpenPanel={onOpenPanel}
        isLoading={socket.isLoading}
        isConnected={socket.isConnected}
        files={files}
        model={model}
        onModelChange={onModelChange}
        effort={effort}
        onEffortChange={onEffortChange}
        cwd={cwd}
        onCwdChange={onCwdChange}
      />
    </div>
  );
}
