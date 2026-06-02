import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Plug, FileText, FilePen, Terminal, Search, Globe, Wrench, ChevronDown, ChevronRight, BookOpen, Bot, FlaskConical, Loader2, XCircle, CheckCircle2, Brain, Check, Copy } from "lucide-react";
import type { Message } from "../../types";
import { CodeHighlight } from "./CodeBlock";

function ToolIcon({ name, className }: { name?: string; className?: string }) {
  const cls = className ?? "w-3.5 h-3.5 text-gray-500 shrink-0";
  if (name?.startsWith("mcp__consultor__")) return <Plug className={cls} />;
  switch (name) {
    case "Read": return <FileText className={cls} />;
    case "Write":
    case "Edit":
    case "MultiEdit": return <FilePen className={cls} />;
    case "Bash": return <Terminal className={cls} />;
    case "Grep":
    case "Glob": return <Search className={cls} />;
    case "WebSearch":
    case "WebFetch": return <Globe className={cls} />;
    default: return <Wrench className={cls} />;
  }
}

export function ToolUseBlock({ message }: { message: Message }) {
  const [isExpanded, setIsExpanded] = useState(false);

  const getToolSummary = () => {
    const input = message.toolInput || {};
    switch (message.toolName) {
      case "Read":
        return input.file_path;
      case "Write":
      case "Edit":
        return input.file_path;
      case "Bash":
        return input.command?.slice(0, 60) + (input.command?.length > 60 ? "..." : "");
      case "Grep":
        return `"${input.pattern}" in ${input.path || "."}`;
      case "Glob":
        return input.pattern;
      case "WebSearch":
        return input.query;
      case "WebFetch":
        return input.url;
      default:
        return JSON.stringify(input).slice(0, 50);
    }
  };

  return (
    <div className="my-2 border border-gray-200 bg-gray-50 rounded">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full p-2 flex items-center justify-between text-left hover:bg-gray-100"
      >
        <div className="flex items-center gap-2 min-w-0">
          <ToolIcon name={message.toolName} />
          <span className="text-xs font-semibold text-gray-600 uppercase shrink-0">
            {message.toolName}
          </span>
          <span className="text-xs text-gray-500 truncate">
            {getToolSummary()}
          </span>
        </div>
        {isExpanded ? (
          <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
        )}
      </button>
      {isExpanded && (
        <div className="p-2 border-t border-gray-200">
          <pre className="text-xs bg-white p-2 rounded overflow-x-auto">
            {JSON.stringify(message.toolInput, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

export function SubAgentCard({ message }: { message: Message }) {
  const input = message.toolInput || {};
  const isGuardian = message.toolName?.startsWith("mcp__consultor__");
  const name = isGuardian ? "guardião" : input.subagent_type || input.agent || input.subagentType || "subagente";
  const label = isGuardian
    ? String(input.pergunta || "Consulta às docs do Agent SDK")
    : String(input.description || input.prompt || "Tarefa delegada");
  // classes estáticas (Tailwind não compila interpolação dinâmica)
  const box = isGuardian ? "border-violet-200 bg-violet-50/50" : "border-indigo-200 bg-indigo-50/50";
  const icon = isGuardian ? "text-violet-500" : "text-indigo-500";
  const nameCls = isGuardian ? "text-violet-700" : "text-indigo-700";
  return (
    <div className={`flex items-center gap-2 my-1 px-3 py-2 rounded-lg border ${box}`}>
      {isGuardian ? <BookOpen className={`w-4 h-4 shrink-0 ${icon}`} /> : <Bot className={`w-4 h-4 shrink-0 ${icon}`} />}
      <span className={`text-xs font-semibold shrink-0 ${nameCls}`}>{name}</span>
      <span className="text-xs text-gray-600 truncate">{label}</span>
    </div>
  );
}

// Card do tester (/test) — agente que só o usuário dispara, com Bash liberado.
// Mostra os comandos executados + o relatório, e o estado (rodando/passou/falhou).
export function TesterCard({ message }: { message: Message }) {
  const running = !message.done;
  const failed = message.done && message.success === false;
  const box = failed ? "border-rose-200 bg-rose-50/50" : "border-emerald-200 bg-emerald-50/40";
  return (
    <div className={`my-1 rounded-lg border ${box}`}>
      <div className="flex items-center gap-2 px-3 py-2">
        <FlaskConical className={`w-4 h-4 shrink-0 ${failed ? "text-rose-500" : "text-emerald-600"}`} />
        <span className={`text-xs font-semibold shrink-0 ${failed ? "text-rose-700" : "text-emerald-700"}`}>tester</span>
        <span className="text-xs text-gray-500 truncate">validação do projeto</span>
        <span className="ml-auto shrink-0">
          {running ? (
            <Loader2 className="w-3.5 h-3.5 text-emerald-500 animate-spin" />
          ) : failed ? (
            <XCircle className="w-3.5 h-3.5 text-rose-500" />
          ) : (
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
          )}
        </span>
      </div>
      {message.commands && message.commands.length > 0 && (
        <div className="px-3 pb-1.5 flex flex-col gap-1">
          {message.commands.map((c, i) => (
            <div key={i} className="flex items-center gap-1.5 text-[11px] font-mono text-gray-500 truncate">
              <Terminal className="w-3 h-3 shrink-0 text-gray-400" />
              <span className="truncate">{c}</span>
            </div>
          ))}
        </div>
      )}
      {message.content && (
        <div className="px-3 pb-2 prose prose-sm max-w-none prose-code:text-pink-600 prose-code:before:content-none prose-code:after:content-none prose-table:text-xs">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{ code: CodeHighlight, pre: ({ children }) => <>{children}</> }}
          >
            {message.content}
          </ReactMarkdown>
        </div>
      )}
      {running && !message.content && (
        <p className="px-3 pb-2 text-xs text-gray-400 italic">rodando…</p>
      )}
    </div>
  );
}

// Bloco de raciocínio (extended thinking) — colapsável, dim, expande durante o stream.
export function ThinkingBlock({ message }: { message: Message }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="my-1 border border-violet-100 bg-violet-50/40 rounded">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full p-2 flex items-center gap-2 text-left hover:bg-violet-50"
      >
        <Brain className="w-3.5 h-3.5 text-violet-500 shrink-0" />
        <span className="text-xs font-medium text-violet-600">Raciocínio</span>
        {open ? (
          <ChevronDown className="w-3.5 h-3.5 text-violet-300 ml-auto" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-violet-300 ml-auto" />
        )}
      </button>
      {open && message.content && (
        <div className="px-3 pb-2 text-xs text-gray-500 italic whitespace-pre-wrap leading-relaxed max-h-60 overflow-y-auto">
          {message.content}
        </div>
      )}
    </div>
  );
}

export function MessageBubble({ message, modelLabel }: { message: Message; modelLabel?: string }) {
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);
  const copyMsg = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className={`flex flex-col ${isUser ? "items-end" : "items-start"} group`}>
      <div
        className={`rounded-lg px-4 py-2 ${
          isUser
            ? "max-w-[80%] bg-blue-600 text-white"
            : "max-w-[90%] bg-gray-100 text-gray-900"
        }`}
      >
        {/* imagens anexadas (user ou assistente) */}
        {message.images && message.images.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {message.images.map((src, i) => (
              <img
                key={i}
                src={src}
                alt={`imagem ${i + 1}`}
                className="max-h-48 max-w-xs rounded border border-gray-300 object-contain"
              />
            ))}
          </div>
        )}
        {isUser ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : (
          // markdown: GFM (tabelas) + Shiki (syntax do VS Code) via componente code
          <div className="prose prose-sm max-w-none prose-code:text-pink-600 prose-code:before:content-none prose-code:after:content-none prose-table:text-xs">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{ code: CodeHighlight, pre: ({ children }) => <>{children}</> }}
            >
              {message.content}
            </ReactMarkdown>
          </div>
        )}
      </div>
      {/* rodapé (só assistente): modelo + copiar, aparece no hover */}
      {!isUser && message.content && (
        <div className="flex items-center gap-2 mt-1 px-1 text-[10px] text-gray-400 opacity-0 group-hover:opacity-100 transition">
          {modelLabel && <span>{modelLabel}</span>}
          <button onClick={copyMsg} className="flex items-center gap-1 hover:text-gray-600" title="copiar mensagem">
            {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            {copied ? "copiado" : "copiar"}
          </button>
        </div>
      )}
    </div>
  );
}
