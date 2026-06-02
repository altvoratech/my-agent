import React, { useRef, useEffect } from "react";
import type { Message } from "../../types";
import { ToolUseBlock, SubAgentCard, TesterCard, ThinkingBlock, MessageBubble } from "./MessageItems";

interface MessageListProps {
  messages: Message[];
  isLoading: boolean;
  agentStatus: string;
  modelLabel: string;
}

export function MessageList({ messages, isLoading, agentStatus, modelLabel }: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null); // container das mensagens
  const pinnedRef = useRef(true); // usuário está colado no final? (senão não puxa o scroll)

  // Auto-scroll durante o streaming: instantâneo (sem animação "smooth" reiniciando
  // a cada token, o que fazia o scroll engasgar) e só quando o usuário já está no
  // final — se ele rolou pra cima pra ler, respeitamos a posição dele.
  useEffect(() => {
    if (!pinnedRef.current) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // recalcula se está "colado" no final a cada scroll (margem de 80px)
  const onMessagesScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  // troca de chat -> recomeça acompanhando o final
  // (o pai remonta este componente via key={chatId}, então o reset acontece na montagem)
  useEffect(() => {
    pinnedRef.current = true;
  }, []);

  return (
    <div ref={scrollRef} onScroll={onMessagesScroll} className="flex-1 overflow-y-auto p-4 space-y-4">
      {messages.length === 0 ? (
        <div className="text-center text-gray-400 mt-8">
          <p>Start a conversation</p>
        </div>
      ) : (
        <>
          {messages.map((msg) =>
            msg.role === "tool_use" ? (
              <ToolUseBlock key={msg.id} message={msg} />
            ) : msg.role === "subagent" ? (
              <SubAgentCard key={msg.id} message={msg} />
            ) : msg.role === "tester" ? (
              <TesterCard key={msg.id} message={msg} />
            ) : msg.role === "thinking" ? (
              <ThinkingBlock key={msg.id} message={msg} />
            ) : (
              <MessageBubble key={msg.id} message={msg} modelLabel={modelLabel} />
            )
          )}
          {isLoading && (
            <div className="flex items-center gap-2 text-gray-500">
              <span className="animate-pulse">●</span>
              <span className="text-sm">{agentStatus}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
