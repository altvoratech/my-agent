import { useState } from "react";
import { Plus, MessageSquare, Pencil, Check, X, Home } from "lucide-react";

interface Chat {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

interface ChatListProps {
  chats: Chat[];
  selectedChatId: string | null;
  onSelectChat: (chatId: string) => void;
  onNewChat: () => void;
  onDeleteChat: (chatId: string) => void;
  onRenameChat: (chatId: string, title: string) => void;
  onGoHome: () => void;
}

export function ChatList({
  chats,
  selectedChatId,
  onSelectChat,
  onNewChat,
  onDeleteChat,
  onRenameChat,
  onGoHome,
}: ChatListProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const startEdit = (chat: Chat) => {
    setEditingId(chat.id);
    setDraft(chat.title);
  };
  const commitEdit = () => {
    if (editingId && draft.trim()) onRenameChat(editingId, draft.trim());
    setEditingId(null);
  };

  return (
    <div className="flex flex-col h-full bg-gray-900 text-white">
      {/* Header */}
      <div className="p-4 border-b border-gray-700 flex gap-2">
        <button
          onClick={onGoHome}
          title="Tela inicial (projetos)"
          className="flex items-center justify-center px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors text-gray-300"
        >
          <Home className="w-4 h-4" />
        </button>
        <button
          onClick={onNewChat}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          <span>New Chat</span>
        </button>
      </div>

      {/* Chat list */}
      <div className="flex-1 overflow-y-auto">
        {chats.length === 0 ? (
          <div className="p-4 text-center text-gray-500">
            <p className="text-sm">No chats yet</p>
            <p className="text-xs mt-1">Clique em "New Chat" para começar</p>
          </div>
        ) : (
          <div className="p-2 space-y-1">
            {chats.map((chat) => (
              <div
                key={chat.id}
                className={`group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                  selectedChatId === chat.id ? "bg-gray-700" : "hover:bg-gray-800"
                }`}
                onClick={() => editingId !== chat.id && onSelectChat(chat.id)}
              >
                <MessageSquare className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                {editingId === chat.id ? (
                  <input
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={commitEdit}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitEdit();
                      else if (e.key === "Escape") setEditingId(null);
                    }}
                    className="flex-1 bg-gray-800 border border-gray-600 rounded px-1.5 py-0.5 text-sm text-white focus:outline-none focus:border-blue-400"
                  />
                ) : (
                  <span className="flex-1 truncate text-sm">{chat.title}</span>
                )}

                {editingId === chat.id ? (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      commitEdit();
                    }}
                    className="p-1 hover:bg-gray-600 rounded text-gray-300 hover:text-white"
                    title="salvar"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>
                ) : (
                  <>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        startEdit(chat);
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1 hover:bg-gray-600 rounded transition-all text-gray-400 hover:text-white"
                      title="renomear"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteChat(chat.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1 hover:bg-gray-600 rounded transition-all text-gray-400 hover:text-white"
                      title="arquivar"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-gray-700">
        <button
          onClick={onGoHome}
          className="w-full text-xs text-gray-500 text-center hover:text-gray-300 transition-colors"
        >
          my-agent-chat
        </button>
      </div>
    </div>
  );
}
