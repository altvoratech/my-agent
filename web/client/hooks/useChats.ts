// Hook da lista de chats (REST via lib/api).
// Move createChat/renameChat/deleteChat/fetchChats do App.tsx, preservando
// os updates otimistas e os toasts (sonner) exatamente como eram.
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import type { Chat } from "../types";
import * as api from "../lib/api";

export function useChats() {
  const [chats, setChats] = useState<Chat[]>([]);

  // Fetch all chats
  const refresh = useCallback(async () => {
    try {
      const data = await api.getChats();
      setChats(data);
    } catch (error) {
      console.error("Failed to fetch chats:", error);
    }
  }, []);

  // Create new chat — herda o cwd (passado, ou o atual). O novo chat já nasce com
  // esse diretório localmente para o effect de restauração não zerá-lo.
  // Retorna o chat criado (ou null em erro) para o App fazer o selectChat.
  const create = useCallback(async (cwdForChat?: string): Promise<Chat | null> => {
    try {
      const chat = await api.createChat();
      if (!chat) throw new Error("createChat retornou null");
      const created = { ...chat, cwd: cwdForChat };
      setChats((prev) => [created, ...prev]);
      return created;
    } catch (error) {
      console.error("Failed to create chat:", error);
      toast.error("Não consegui criar o chat.");
      return null;
    }
  }, []);

  // Rename chat
  const rename = useCallback(async (chatId: string, title: string) => {
    let prevTitle: string | undefined;
    // otimista: atualiza local já; persiste no servidor
    setChats((prev) =>
      prev.map((c) => {
        if (c.id === chatId) {
          prevTitle = c.title;
          return { ...c, title };
        }
        return c;
      }),
    );
    try {
      await api.renameChat(chatId, title);
    } catch (error) {
      console.error("Failed to rename chat:", error);
      toast.error("Não consegui renomear o chat.");
      // reverte o otimista
      if (prevTitle !== undefined) setChats((prev) => prev.map((c) => (c.id === chatId ? { ...c, title: prevTitle! } : c)));
    }
  }, []);

  // Delete chat — retorna true se removeu, para o App decidir o goHome.
  const remove = useCallback(async (chatId: string): Promise<boolean> => {
    try {
      await api.deleteChat(chatId);
      setChats((prev) => prev.filter((c) => c.id !== chatId));
      return true;
    } catch (error) {
      console.error("Failed to delete chat:", error);
      toast.error("Não consegui arquivar o chat.");
      return false;
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { chats, refresh, create, rename, remove };
}
