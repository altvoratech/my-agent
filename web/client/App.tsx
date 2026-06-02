import { useState, useEffect, useRef } from "react";
import { Toaster } from "sonner";
import { Wrench, ListTodo, GitBranch } from "lucide-react";
import { ChatList } from "./components/ChatList";
import { ToolPanel } from "./components/ToolPanel";
import { GitPanel } from "./components/GitPanel";
import { TaskPanel } from "./components/TaskPanel";
import { ApprovalModal } from "./components/ApprovalModal";
import { getFiles } from "./lib/api";
import { Chat } from "./routes/Chat";
import { Launcher } from "./routes/Launcher";
import { useChatRoute } from "./hooks/useChatRoute";
import { useChats } from "./hooks/useChats";
import { useProjects } from "./hooks/useProjects";
import { useGitDiff } from "./hooks/useGitDiff";
import { useAgentSocket } from "./hooks/useAgentSocket";

export default function App() {
  // estado de sessão que o App ainda controla (passado pro socket e pro <Chat/>)
  const [model, setModel] = useState("claude-sonnet-4-6");
  const [effort, setEffort] = useState<string>(""); // "" = default do SDK
  const [cwd, setCwd] = useState("");
  const [rightTab, setRightTab] = useState<"tools" | "tasks" | "git">("tools");
  // lista de arquivos do projeto (autocomplete @) — segue o cwd, igual a ChatWindow antiga
  const [files, setFiles] = useState<string[]>([]);

  // roteamento (History API), lista de chats, projetos recentes e diff do git
  const { selectedChatId, selectChat, goHome } = useChatRoute();
  const chats = useChats();
  const projects = useProjects();
  const git = useGitDiff(cwd);

  // socket + todo o estado do streaming; no fim de cada turno, atualiza git/projetos/chats
  const socket = useAgentSocket({
    chatId: selectedChatId,
    model,
    effort,
    cwd,
    onResult: () => {
      git.refresh();
      projects.refresh();
      chats.refresh();
    },
  });

  // restaura o diretório do chat ao TROCAR de seleção (uma vez por seleção, para
  // não atropelar edições manuais do campo nem o cwd de um chat recém-aberto).
  const lastCwdChat = useRef<string | null>(null);
  useEffect(() => {
    if (selectedChatId === lastCwdChat.current) return;
    const chat = chats.chats.find((c) => c.id === selectedChatId);
    if (!chat) return; // ainda não carregou; o effect roda de novo quando `chats` mudar
    lastCwdChat.current = selectedChatId;
    setCwd(chat.cwd ?? "");
  }, [selectedChatId, chats.chats]);

  // carrega a lista de arquivos do projeto (para o autocomplete @) — segue o cwd
  useEffect(() => {
    getFiles(cwd).then(setFiles).catch(() => {});
  }, [cwd]);

  // criar novo chat — herda o cwd (passado, ou o atual) e já seleciona
  const createChat = async (cwdForChat?: string) => {
    const useCwd = typeof cwdForChat === "string" ? cwdForChat : cwd;
    const chat = await chats.create(useCwd);
    if (chat) selectChat(chat.id);
  };

  // abre um projeto: seta o cwd e cria um novo chat já nele
  const openProject = (path: string) => {
    setCwd(path);
    createChat(path);
  };

  // arquivar chat -> se era o selecionado, volta pra tela inicial
  const deleteChat = async (chatId: string) => {
    await chats.remove(chatId);
    if (selectedChatId === chatId) goHome();
  };

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <div className="w-64 shrink-0">
        <ChatList
          chats={chats.chats}
          selectedChatId={selectedChatId}
          onSelectChat={selectChat}
          onNewChat={createChat}
          onDeleteChat={deleteChat}
          onRenameChat={chats.rename}
          onGoHome={goHome}
        />
      </div>

      {/* Centro: chat selecionado ou launcher */}
      {selectedChatId ? (
        <Chat
          chatId={selectedChatId}
          model={model}
          effort={effort}
          cwd={cwd}
          onModelChange={setModel}
          onEffortChange={setEffort}
          onCwdChange={setCwd}
          socket={socket}
          files={files}
          onNewChat={createChat}
          onOpenPanel={setRightTab}
          onOpenProject={openProject}
        />
      ) : (
        <Launcher recentProjects={projects.recentProjects} onOpenProject={openProject} />
      )}

      {/* Painel direito: abas Tools (ao vivo) / Tarefas / Git (diff das edições) */}
      {selectedChatId && (
        <div className="w-80 shrink-0 border-l border-gray-200 bg-gray-50 flex flex-col">
          <div className="flex border-b border-gray-200 text-sm">
            <button
              onClick={() => setRightTab("tools")}
              className={`flex-1 px-3 py-2 font-medium flex items-center justify-center gap-1.5 ${
                rightTab === "tools" ? "bg-white text-gray-900 border-b-2 border-blue-500" : "text-gray-500 hover:bg-gray-100"
              }`}
            >
              <Wrench className="w-4 h-4" /> Tools <span className="text-xs text-gray-400">{socket.toolEvents.length}</span>
            </button>
            <button
              onClick={() => setRightTab("tasks")}
              className={`flex-1 px-3 py-2 font-medium flex items-center justify-center gap-1.5 ${
                rightTab === "tasks" ? "bg-white text-gray-900 border-b-2 border-blue-500" : "text-gray-500 hover:bg-gray-100"
              }`}
            >
              <ListTodo className="w-4 h-4" /> Tarefas {socket.todos.length > 0 && <span className="text-xs text-gray-400">{socket.todos.length}</span>}
            </button>
            <button
              onClick={() => {
                setRightTab("git");
                git.refresh();
              }}
              className={`flex-1 px-3 py-2 font-medium flex items-center justify-center gap-1.5 ${
                rightTab === "git" ? "bg-white text-gray-900 border-b-2 border-blue-500" : "text-gray-500 hover:bg-gray-100"
              }`}
            >
              <GitBranch className="w-4 h-4" /> Git
            </button>
          </div>
          <div className="flex-1 min-h-0">
            {rightTab === "tools" && <ToolPanel events={socket.toolEvents} />}
            {rightTab === "tasks" && <TaskPanel todos={socket.todos} />}
            {rightTab === "git" && (
              <GitPanel diff={git.git.diff} status={git.git.status} numstat={git.git.numstat} onRefresh={git.refresh} lastTurnFiles={socket.lastTurnFiles} />
            )}
          </div>
        </div>
      )}

      {/* modal de aprovação (human-in-the-loop) */}
      {socket.approval && (
        <ApprovalModal
          req={socket.approval}
          onApprove={() => socket.respondApproval(true)}
          onApproveAlways={socket.approveAlways}
          onReject={() => socket.respondApproval(false)}
        />
      )}

      {/* toasts (erros do servidor, etc.) */}
      <Toaster position="top-right" richColors closeButton />
    </div>
  );
}
