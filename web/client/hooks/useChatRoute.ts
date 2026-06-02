import { useState, useEffect, useCallback } from "react";

// roteamento simples (History API): / = launcher, /chat/<id> = chat
function chatIdFromPath(): string | null {
  const m = window.location.pathname.match(/^\/chat\/(.+)$/);
  return m ? decodeURIComponent(m[1]) : null;
}

// Hook de roteamento extraído do App: mantém o id do chat selecionado em sincronia
// com a URL (History API) e responde ao back/forward do browser via popstate.
export function useChatRoute() {
  const [selectedChatId, setSelectedChatId] = useState<string | null>(() => chatIdFromPath());

  // Seleciona um chat -> reflete na URL (/chat/<id>).
  const selectChat = useCallback((chatId: string) => {
    setSelectedChatId(chatId);
    if (chatIdFromPath() !== chatId) window.history.pushState({}, "", `/chat/${chatId}`);
  }, []);

  // Volta para a tela inicial (launcher) -> URL /
  const goHome = useCallback(() => {
    setSelectedChatId(null);
    if (window.location.pathname !== "/") window.history.pushState({}, "", "/");
  }, []);

  // back/forward do browser: sincroniza a seleção com a URL
  useEffect(() => {
    const onPop = () => {
      setSelectedChatId(chatIdFromPath());
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  return { selectedChatId, selectChat, goHome };
}
