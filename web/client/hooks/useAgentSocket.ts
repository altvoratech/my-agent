import { useState, useEffect, useCallback, useRef } from "react";
import useWebSocket, { ReadyState } from "react-use-websocket";
import { toast } from "sonner";
import { MAX_TOOL_EVENTS, type PanelEvent } from "../components/ToolPanel";
import { type Todo } from "../components/TaskPanel";
import { type ApprovalRequest } from "../components/ApprovalModal";
import type { Message } from "../types";

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

// mantém só os MAX_TOOL_EVENTS mais recentes (param tipado preserva os literais de `kind`)
const capEvents = (events: PanelEvent[]): PanelEvent[] => events.slice(-MAX_TOOL_EVENTS);

// WS do agente: ws://hostname:3001/ws
const WS_URL = `ws://${window.location.hostname}:3001/ws`;

export interface UseAgentSocketOpts {
  chatId: string | null;
  model: string;
  effort: string;
  cwd: string;
  onResult?: () => void;
}

export function useAgentSocket(opts: UseAgentSocketOpts) {
  const { chatId, model, effort, cwd, onResult } = opts;

  // onResult vem como arrow NOVA a cada render do App. Guardar num ref (atualizado
  // a cada render) mantém handleWSMessage ESTÁVEL — senão o effect que processa
  // lastJsonMessage re-roda a cada render e reprocessa a mesma msg -> loop infinito.
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  const [messages, setMessages] = useState<Message[]>([]);
  const [toolEvents, setToolEvents] = useState<PanelEvent[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [agentStatus, setAgentStatus] = useState("Pensando...");
  const [isLoading, setIsLoading] = useState(false);
  const [lastResult, setLastResult] = useState<{ cost?: number; duration?: number; inputTokens?: number; outputTokens?: number } | null>(null);
  const [approval, setApproval] = useState<ApprovalRequest | null>(null);
  // tools que o usuário marcou como "✓ Sempre" -> auto-aprovadas no resto da sessão
  const [alwaysApprove, setAlwaysApprove] = useState<Set<string>>(new Set());
  // arquivos que o agente editou no turno atual (para o escopo "último turno" do Git)
  const [lastTurnFiles, setLastTurnFiles] = useState<string[]>([]);

  // Handle WebSocket messages
  const handleWSMessage = useCallback((message: any) => {
    switch (message.type) {
      case "connected":
        console.log("Connected to server");
        break;

      case "history":
        // mensagens do tester persistidas já terminaram -> done (sem spinner eterno)
        setMessages(
          (message.messages || []).map((m: Message) => (m.role === "tester" ? { ...m, done: true } : m))
        );
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
        // delegações (Agent/Task) e consulta ao guardião viram CARD inline no fluxo (como o opencode),
        // em vez de irem só para o painel de atividade.
        if (message.toolName === "Task" || message.toolName === "Agent" || message.toolName?.startsWith("mcp__consultor__")) {
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
        setToolEvents((prev) => capEvents([
          ...prev,
          {
            id: message.toolId,
            kind: "tool",
            toolName: message.toolName,
            toolInput: message.toolInput,
            timestamp: new Date().toISOString(),
          },
        ]));
        break;

      case "prefetch":
        setAgentStatus("Ancorando nas fontes...");
        setToolEvents((prev) => capEvents([
          ...prev,
          {
            id: crypto.randomUUID(),
            kind: "prefetch",
            hits: message.hits,
            sources: message.sources || [],
            timestamp: new Date().toISOString(),
          },
        ]));
        break;

      case "guard":
        setToolEvents((prev) => capEvents([
          ...prev,
          {
            id: crypto.randomUUID(),
            kind: "guard",
            tool: message.tool,
            reason: message.reason,
            timestamp: new Date().toISOString(),
          },
        ]));
        break;

      case "result":
        setIsLoading(false);
        setLastResult({
          cost: message.cost,
          duration: message.duration,
          inputTokens: message.inputTokens,
          outputTokens: message.outputTokens,
        });
        // Refresh chat list / git diff / projetos recentes (delegado ao App via onResult)
        onResultRef.current?.();
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

      // --- tester (/test): agente que só o usuário dispara, com Bash liberado ---
      case "tester_start":
        setMessages((prev) => [
          ...prev,
          { id: message.id, role: "tester", content: "", commands: [], timestamp: new Date().toISOString() },
        ]);
        setAgentStatus("Rodando testes...");
        break;

      case "tester_delta":
        setMessages((prev) =>
          prev.map((m) => (m.id === message.id ? { ...m, content: m.content + message.text } : m))
        );
        break;

      case "tester_tool":
        setMessages((prev) =>
          prev.map((m) =>
            m.id === message.id ? { ...m, commands: [...(m.commands || []), message.command] } : m
          )
        );
        setAgentStatus(`$ ${String(message.command || "").slice(0, 48)}`);
        break;

      case "tester_end":
        setMessages((prev) =>
          prev.map((m) => (m.id === message.id ? { ...m, done: true, success: message.success } : m))
        );
        setAgentStatus("");
        onResultRef.current?.(); // o tester pode ter mexido em arquivos via Bash
        if (message.success === false) toast.error(`Tester falhou: ${message.error || "erro"}`);
        break;
    }
  }, []);

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

  const respondApproval = useCallback((approved: boolean) => {
    if (approval && chatId) {
      sendJsonMessage({ type: "approval", chatId, id: approval.id, approved });
    }
    setApproval(null);
  }, [approval, chatId, sendJsonMessage]);

  // "✓ Sempre": aprova agora e memoriza a tool para auto-aprovar as próximas
  const approveAlways = useCallback(() => {
    if (!approval) return;
    setAlwaysApprove((prev) => new Set(prev).add(approval.tool));
    respondApproval(true);
  }, [approval, respondApproval]);

  // auto-aprova (sem modal) as tools que o usuário marcou como "✓ Sempre"
  useEffect(() => {
    if (approval && alwaysApprove.has(approval.tool) && chatId) {
      sendJsonMessage({ type: "approval", chatId, id: approval.id, approved: true });
      setApproval(null);
    }
  }, [approval, alwaysApprove, chatId, sendJsonMessage]);

  // (re)subscribe sempre que conectar com um chat selecionado (cobre load inicial e reconexão)
  useEffect(() => {
    if (isConnected && chatId) sendJsonMessage({ type: "subscribe", chatId });
  }, [isConnected, chatId, sendJsonMessage]);

  // Interrompe o turno atual do agente
  const stop = useCallback(() => {
    if (chatId) sendJsonMessage({ type: "stop", chatId });
  }, [chatId, sendJsonMessage]);

  // /compact: aciona a compactação de contexto do SDK no backend
  const compact = useCallback(() => {
    if (!chatId || !isConnected) return;
    setIsLoading(true);
    setAgentStatus("Compactando contexto...");
    sendJsonMessage({ type: "command", chatId, name: "compact" });
  }, [chatId, isConnected, sendJsonMessage]);

  // /test: dispara o tester (Bash liberado). instruction opcional foca o que rodar.
  const runTest = useCallback((instruction?: string) => {
    if (!chatId || !isConnected) return;
    setAgentStatus("Rodando testes...");
    sendJsonMessage({ type: "command", chatId, name: "test", cwd, args: instruction });
  }, [chatId, isConnected, cwd, sendJsonMessage]);

  // Send a message
  const sendMessage = useCallback((content: string, images?: { media_type: string; data: string }[], enhancedFrom?: string) => {
    if (!chatId || !isConnected) return;

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
      chatId,
      model,
      cwd: cwd.trim() || undefined,
      effort: effort || undefined,
      enhancedFrom,
      images,
    });
  }, [chatId, isConnected, model, cwd, effort, sendJsonMessage]);

  return {
    isConnected,
    messages,
    toolEvents,
    todos,
    agentStatus,
    isLoading,
    lastResult,
    approval,
    lastTurnFiles,
    sendMessage,
    stop,
    compact,
    runTest,
    respondApproval,
    approveAlways,
    setMessages,
  };
}
