import { useState, useEffect, useCallback, useRef } from "react";
import useWebSocket, { ReadyState } from "react-use-websocket";
import { Toaster, toast } from "sonner";
import { Wrench, ListTodo, GitBranch } from "lucide-react";
import { ChatList } from "./components/ChatList";
import { ChatWindow } from "./components/ChatWindow";
import { ToolPanel, type PanelEvent } from "./components/ToolPanel";
import { GitPanel } from "./components/GitPanel";
import { TaskPanel, type Todo } from "./components/TaskPanel";
import { ApprovalModal, type ApprovalRequest } from "./components/ApprovalModal";

interface Chat {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  cwd?: string; // diretório de trabalho do chat
}

interface Message {
  id: string;
  role: "user" | "assistant" | "tool_use" | "thinking" | "subagent";
  content: string;
  timestamp: string;
  toolName?: string;
  toolInput?: Record<string, any>;
  images?: string[]; // URLs (/uploads/...) ou data: das imagens da mensagem
}

// status legível do que o agente está fazendo agora (a partir do nome da tool)
function statusForTool(name: string, input: any = {}): string {
  const base = (p?: string) => (p ? p.split("/").pop() : "");
  if (name.startsWith("mcp__consultor__")) return "Consultando o guardião...";
  switch (name) {
    case "Read": return `Lendo ${base(input.file_path)}...`;
    case "Edit":
    case "Write":
    case "MultiEdit": return `Editando ${base(input.file_path)}...`;
    case "Bash": return "Rodando comando...";
    case "Glob":
    case "Grep": return "Procurando no código...";
    case "TodoWrite": return "Planejando as etapas...";
    case "ToolSearch": return "Carregando ferramentas...";
    default: return `Usando ${name}...`;
  }
}

// Use relative URLs - Vite will proxy to the backend
const API_BASE = "/api";
const WS_URL = `ws://${window.location.hostname}:3001/ws`;

// roteamento simples (History API): / = launcher, /chat/<id> = chat
function chatIdFromPath(): string | null {
  const m = window.location.pathname.match(/^\/chat\/(.+)$/);
  return m ? decodeURIComponent(m[1]) : null;
}

export default function App() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(() => chatIdFromPath());
  const [messages, setMessages] = useState<Message[]>([]);
  const [toolEvents, setToolEvents] = useState<PanelEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [rightTab, setRightTab] = useState<"tools" | "tasks" | "git">("tools");
  const [git, setGit] = useState({ diff: "", status: "", numstat: "" });
  // arquivos que o agente editou no turno atual (para o escopo "último turno" do Git)
  const [lastTurnFiles, setLastTurnFiles] = useState<string[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [model, setModel] = useState("claude-sonnet-4-6");
  const [effort, setEffort] = useState<string>(""); // "" = default do SDK
  const [cwd, setCwd] = useState(window.location.hostname === "localhost" ? "" : "");
  const [agentStatus, setAgentStatus] = useState("Pensando...");
  const [approval, setApproval] = useState<ApprovalRequest | null>(null);
  // tools que o usuário marcou como "✓ Sempre" -> auto-aprovadas no resto da sessão
  const [alwaysApprove, setAlwaysApprove] = useState<Set<string>>(new Set());
  const [lastResult, setLastResult] = useState<{ cost?: number; duration?: number; inputTokens?: number; outputTokens?: number } | null>(null);
  const [recentProjects, setRecentProjects] = useState<{ path: string; name: string; lastOpenedAt: string; branch: string }[]>([]);

  const fetchGitDiff = useCallback(async () => {
    try {
      const q = cwd.trim() ? `?cwd=${encodeURIComponent(cwd.trim())}` : "";
      const res = await fetch(`${API_BASE}/git/diff${q}`);
      const data = await res.json();
      setGit({ diff: data.diff || "", status: data.status || "", numstat: data.numstat || "" });
    } catch (error) {
      console.error("Failed to fetch git diff:", error);
    }
  }, [cwd]);

  // Handle WebSocket messages
  const handleWSMessage = useCallback((message: any) => {
    switch (message.type) {
      case "connected":
        console.log("Connected to server");
        break;

      case "history":
        setMessages(message.messages || []);
        break;

      case "user_message":
        // User message already added locally
        break;

      case "assistant_message":
        // fallback (sem streaming): mensagem inteira de uma vez
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: message.content,
            timestamp: new Date().toISOString(),
          },
        ]);
        setAgentStatus("Escrevendo...");
        break;

      case "assistant_start":
        // abre uma bolha vazia que será preenchida pelos deltas
        setMessages((prev) => [
          ...prev,
          { id: message.id, role: "assistant", content: "", timestamp: new Date().toISOString() },
        ]);
        setAgentStatus("Escrevendo...");
        break;

      case "assistant_delta":
        // anexa o token à bolha em streaming
        setMessages((prev) =>
          prev.map((m) => (m.id === message.id ? { ...m, content: m.content + message.text } : m))
        );
        break;

      case "assistant_end":
        break;

      case "thinking_start":
        setAgentStatus("Raciocinando...");
        setMessages((prev) => [
          ...prev,
          { id: message.id, role: "thinking", content: "", timestamp: new Date().toISOString() },
        ]);
        break;

      case "thinking_delta":
        setMessages((prev) =>
          prev.map((m) => (m.id === message.id ? { ...m, content: m.content + message.text } : m))
        );
        break;

      case "thinking_end":
        break;

      case "tool_use":
        setAgentStatus(statusForTool(message.toolName, message.toolInput));
        // TodoWrite = plano do agente -> vai pro painel de Tarefas (substitui a lista).
        if (message.toolName === "TodoWrite") {
          setTodos(message.toolInput?.todos || []);
          break;
        }
        // edições de arquivo -> registra para o escopo "último turno" do Git
        if (["Write", "Edit", "MultiEdit"].includes(message.toolName) && message.toolInput?.file_path) {
          setLastTurnFiles((prev) =>
            prev.includes(message.toolInput.file_path) ? prev : [...prev, message.toolInput.file_path]
          );
        }
        // delegações (Task) e consulta ao guardião viram CARD inline no fluxo (como o opencode),
        // em vez de irem só para o painel de atividade.
        if (message.toolName === "Task" || message.toolName?.startsWith("mcp__consultor__")) {
          setMessages((prev) => [
            ...prev,
            {
              id: message.toolId || crypto.randomUUID(),
              role: "subagent",
              content: "",
              timestamp: new Date().toISOString(),
              toolName: message.toolName,
              toolInput: message.toolInput,
            },
          ]);
          break; // não duplica no painel direito
        }
        // demais tools vão para o painel de atividade (não polui a conversa).
        setToolEvents((prev) => [
          ...prev,
          {
            id: message.toolId,
            kind: "tool",
            toolName: message.toolName,
            toolInput: message.toolInput,
            timestamp: new Date().toISOString(),
          },
        ]);
        break;

      case "prefetch":
        setAgentStatus("Ancorando nas fontes...");
        setToolEvents((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            kind: "prefetch",
            hits: message.hits,
            sources: message.sources || [],
            timestamp: new Date().toISOString(),
          },
        ]);
        break;

      case "guard":
        setToolEvents((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            kind: "guard",
            tool: message.tool,
            reason: message.reason,
            timestamp: new Date().toISOString(),
          },
        ]);
        break;

      case "result":
        setIsLoading(false);
        setLastResult({
          cost: message.cost,
          duration: message.duration,
          inputTokens: message.inputTokens,
          outputTokens: message.outputTokens,
        });
        // Refresh chat list to get updated titles
        fetchChats();
        // o agente pode ter editado arquivos -> atualiza o diff
        fetchGitDiff();
        // o diretório usado vira/atualiza projeto recente
        fetchProjects();
        break;

      case "approval_request":
        setAgentStatus("Aguardando sua confirmação...");
        setApproval({ id: message.id, tool: message.tool, input: message.input });
        break;

      case "error":
        console.error("Server error:", message.error);
        setIsLoading(false);
        toast.error(message.error || "Erro desconhecido no servidor.");
        break;

      case "notice":
        // avisos do backend (ex: contexto compactado)
        if (message.level === "success") toast.success(message.text);
        else toast(message.text);
        break;
    }
  }, [fetchGitDiff]);

  const respondApproval = (approved: boolean) => {
    if (approval && selectedChatId) {
      sendJsonMessage({ type: "approval", chatId: selectedChatId, id: approval.id, approved });
    }
    setApproval(null);
  };

  // "✓ Sempre": aprova agora e memoriza a tool para auto-aprovar as próximas
  const approveAlways = () => {
    if (!approval) return;
    setAlwaysApprove((prev) => new Set(prev).add(approval.tool));
    respondApproval(true);
  };

  const { sendJsonMessage, readyState, lastJsonMessage } = useWebSocket(WS_URL, {
    shouldReconnect: () => true,
    reconnectAttempts: 10,
    reconnectInterval: 3000,
  });

  const isConnected = readyState === ReadyState.OPEN;

  // Handle incoming WebSocket messages
  useEffect(() => {
    if (lastJsonMessage) {
      handleWSMessage(lastJsonMessage);
    }
  }, [lastJsonMessage, handleWSMessage]);

  // auto-aprova (sem modal) as tools que o usuário marcou como "✓ Sempre"
  useEffect(() => {
    if (approval && alwaysApprove.has(approval.tool) && selectedChatId) {
      sendJsonMessage({ type: "approval", chatId: selectedChatId, id: approval.id, approved: true });
      setApproval(null);
    }
  }, [approval, alwaysApprove, selectedChatId, sendJsonMessage]);

  // Fetch all chats
  const fetchChats = async () => {
    try {
      const res = await fetch(`${API_BASE}/chats`);
      const data = await res.json();
      setChats(data);
    } catch (error) {
      console.error("Failed to fetch chats:", error);
    }
  };

  // Create new chat — herda o cwd (passado, ou o atual). O novo chat já nasce com
  // esse diretório localmente para o effect de restauração não zerá-lo.
  const createChat = async (cwdForChat?: string) => {
    const useCwd = cwdForChat ?? cwd;
    try {
      const res = await fetch(`${API_BASE}/chats`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const chat = await res.json();
      setChats((prev) => [{ ...chat, cwd: useCwd }, ...prev]);
      selectChat(chat.id);
    } catch (error) {
      console.error("Failed to create chat:", error);
      toast.error("Não consegui criar o chat.");
    }
  };

  // Rename chat
  const renameChat = async (chatId: string, title: string) => {
    const prevTitle = chats.find((c) => c.id === chatId)?.title;
    // otimista: atualiza local já; persiste no servidor
    setChats((prev) => prev.map((c) => (c.id === chatId ? { ...c, title } : c)));
    try {
      const res = await fetch(`${API_BASE}/chats/${chatId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (error) {
      console.error("Failed to rename chat:", error);
      toast.error("Não consegui renomear o chat.");
      // reverte o otimista
      if (prevTitle !== undefined) setChats((prev) => prev.map((c) => (c.id === chatId ? { ...c, title: prevTitle } : c)));
    }
  };

  // Delete chat
  const deleteChat = async (chatId: string) => {
    try {
      const res = await fetch(`${API_BASE}/chats/${chatId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setChats((prev) => prev.filter((c) => c.id !== chatId));
      if (selectedChatId === chatId) goHome();
    } catch (error) {
      console.error("Failed to delete chat:", error);
      toast.error("Não consegui arquivar o chat.");
    }
  };

  // limpa o estado da view ao trocar de chat (o subscribe recarrega o histórico)
  const resetChatView = () => {
    setMessages([]);
    setToolEvents([]);
    setTodos([]);
    setApproval(null);
    setAlwaysApprove(new Set());
    setIsLoading(false);
  };

  // Select a chat -> reflete na URL (/chat/<id>). O cwd é restaurado pelo effect abaixo.
  const selectChat = (chatId: string) => {
    resetChatView();
    setSelectedChatId(chatId);
    if (chatIdFromPath() !== chatId) window.history.pushState({}, "", `/chat/${chatId}`);
  };

  // restaura o diretório do chat ao TROCAR de seleção (uma vez por seleção, para
  // não atropelar edições manuais do campo nem o cwd de um chat recém-aberto).
  const lastCwdChat = useRef<string | null>(null);
  useEffect(() => {
    if (selectedChatId === lastCwdChat.current) return;
    const chat = chats.find((c) => c.id === selectedChatId);
    if (!chat) return; // ainda não carregou; o effect roda de novo quando `chats` mudar
    lastCwdChat.current = selectedChatId;
    setCwd(chat.cwd ?? "");
  }, [selectedChatId, chats]);

  // Volta para a tela inicial (launcher) -> URL /
  const goHome = () => {
    resetChatView();
    setSelectedChatId(null);
    if (window.location.pathname !== "/") window.history.pushState({}, "", "/");
  };

  // back/forward do browser: sincroniza a seleção com a URL
  useEffect(() => {
    const onPop = () => {
      resetChatView();
      setSelectedChatId(chatIdFromPath());
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // (re)subscribe sempre que conectar com um chat selecionado (cobre load inicial e reconexão)
  useEffect(() => {
    if (isConnected && selectedChatId) sendJsonMessage({ type: "subscribe", chatId: selectedChatId });
  }, [isConnected, selectedChatId, sendJsonMessage]);

  // Interrompe o turno atual do agente
  const handleStop = () => {
    if (selectedChatId) sendJsonMessage({ type: "stop", chatId: selectedChatId });
  };

  // /compact: aciona a compactação de contexto do SDK no backend
  const handleCompact = () => {
    if (!selectedChatId || !isConnected) return;
    setIsLoading(true);
    setAgentStatus("Compactando contexto...");
    sendJsonMessage({ type: "command", chatId: selectedChatId, name: "compact" });
  };

  // Send a message
  const handleSendMessage = (content: string, images?: { media_type: string; data: string }[], enhancedFrom?: string) => {
    if (!selectedChatId || !isConnected) return;

    // Add message optimistically (imagens como data: para aparecer imediatamente)
    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: "user",
        content: content || "",
        timestamp: new Date().toISOString(),
        images: images?.map((img) => `data:${img.media_type};base64,${img.data}`),
      },
    ]);

    setIsLoading(true);
    setAgentStatus("Pensando...");
    setLastTurnFiles([]); // novo turno -> zera os arquivos editados

    // Send via WebSocket
    sendJsonMessage({
      type: "chat",
      content,
      chatId: selectedChatId,
      model,
      cwd: cwd.trim() || undefined,
      effort: effort || undefined,
      enhancedFrom,
      images,
    });
  };

  // projetos recentes (tela inicial)
  const fetchProjects = async () => {
    try {
      const res = await fetch(`${API_BASE}/projects`);
      const data = await res.json();
      setRecentProjects(data.projects || []);
    } catch (error) {
      console.error("Failed to fetch projects:", error);
    }
  };

  // abre um projeto: seta o cwd e cria um novo chat já nele
  const openProject = (path: string) => {
    setCwd(path);
    createChat(path);
  };

  // Initial fetch
  useEffect(() => {
    fetchChats();
    fetchProjects();
  }, []);

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <div className="w-64 shrink-0">
        <ChatList
          chats={chats}
          selectedChatId={selectedChatId}
          onSelectChat={selectChat}
          onNewChat={createChat}
          onDeleteChat={deleteChat}
          onRenameChat={renameChat}
          onGoHome={goHome}
        />
      </div>

      {/* Main chat area */}
      <ChatWindow
        chatId={selectedChatId}
        messages={messages}
        isConnected={isConnected}
        isLoading={isLoading}
        onSendMessage={handleSendMessage}
        onStop={handleStop}
        model={model}
        onModelChange={setModel}
        effort={effort}
        onEffortChange={setEffort}
        cwd={cwd}
        onCwdChange={setCwd}
        agentStatus={agentStatus}
        lastResult={lastResult}
        onNewChat={createChat}
        onOpenPanel={setRightTab}
        onCompact={handleCompact}
        recentProjects={recentProjects}
        onOpenProject={openProject}
      />

      {/* Painel direito: abas Tools (ao vivo) / Git (diff das edições) */}
      {selectedChatId && (
        <div className="w-80 shrink-0 border-l border-gray-200 bg-gray-50 flex flex-col">
          <div className="flex border-b border-gray-200 text-sm">
            <button
              onClick={() => setRightTab("tools")}
              className={`flex-1 px-3 py-2 font-medium flex items-center justify-center gap-1.5 ${
                rightTab === "tools" ? "bg-white text-gray-900 border-b-2 border-blue-500" : "text-gray-500 hover:bg-gray-100"
              }`}
            >
              <Wrench className="w-4 h-4" /> Tools <span className="text-xs text-gray-400">{toolEvents.length}</span>
            </button>
            <button
              onClick={() => setRightTab("tasks")}
              className={`flex-1 px-3 py-2 font-medium flex items-center justify-center gap-1.5 ${
                rightTab === "tasks" ? "bg-white text-gray-900 border-b-2 border-blue-500" : "text-gray-500 hover:bg-gray-100"
              }`}
            >
              <ListTodo className="w-4 h-4" /> Tarefas {todos.length > 0 && <span className="text-xs text-gray-400">{todos.length}</span>}
            </button>
            <button
              onClick={() => {
                setRightTab("git");
                fetchGitDiff();
              }}
              className={`flex-1 px-3 py-2 font-medium flex items-center justify-center gap-1.5 ${
                rightTab === "git" ? "bg-white text-gray-900 border-b-2 border-blue-500" : "text-gray-500 hover:bg-gray-100"
              }`}
            >
              <GitBranch className="w-4 h-4" /> Git
            </button>
          </div>
          <div className="flex-1 min-h-0">
            {rightTab === "tools" && <ToolPanel events={toolEvents} />}
            {rightTab === "tasks" && <TaskPanel todos={todos} />}
            {rightTab === "git" && (
              <GitPanel diff={git.diff} status={git.status} numstat={git.numstat} onRefresh={fetchGitDiff} lastTurnFiles={lastTurnFiles} />
            )}
          </div>
        </div>
      )}

      {/* modal de aprovação (human-in-the-loop) */}
      {approval && (
        <ApprovalModal
          req={approval}
          onApprove={() => respondApproval(true)}
          onApproveAlways={approveAlways}
          onReject={() => respondApproval(false)}
        />
      )}

      {/* toasts (erros do servidor, etc.) */}
      <Toaster position="top-right" richColors closeButton />
    </div>
  );
}
