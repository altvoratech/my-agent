import React, { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { codeToHtml } from "shiki";
import TextareaAutosize from "react-textarea-autosize";
import { toast } from "sonner";
import {
  Folder, Send, Square, X, Copy, Check, ChevronRight, ChevronDown,
  Plug, Terminal, FileText, FilePen, Search, Globe, Wrench, GitBranch, Brain, Bot, BookOpen,
  Wand2, Loader2, FolderOpen, ArrowRight,
} from "lucide-react";

// tempo relativo curto ("há 3 min", "há 2 h", "há 5 d")
function relTime(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "agora";
  if (diff < 3600) return `há ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `há ${Math.floor(diff / 3600)} h`;
  return `há ${Math.floor(diff / 86400)} d`;
}

interface Message {
  id: string;
  role: "user" | "assistant" | "tool_use" | "thinking" | "subagent";
  content: string;
  timestamp: string;
  toolName?: string;
  toolInput?: Record<string, any>;
  images?: string[]; // URLs /uploads/... ou data: (preview otimista)
}

interface ChatWindowProps {
  chatId: string | null;
  messages: Message[];
  isConnected: boolean;
  isLoading: boolean;
  onSendMessage: (content: string, images?: { media_type: string; data: string }[], enhancedFrom?: string) => void;
  onStop: () => void;
  model: string;
  onModelChange: (model: string) => void;
  effort: string;
  onEffortChange: (e: string) => void;
  cwd: string;
  onCwdChange: (cwd: string) => void;
  agentStatus: string;
  lastResult: { cost?: number; duration?: number; inputTokens?: number; outputTokens?: number } | null;
  onNewChat: () => void;
  onOpenPanel: (tab: "tools" | "tasks" | "git") => void;
  onCompact: () => void;
  recentProjects: { path: string; name: string; lastOpenedAt: string; branch: string }[];
  onOpenProject: (path: string) => void;
}

const EFFORTS = [
  { id: "", label: "Padrão" },
  { id: "low", label: "Baixo" },
  { id: "medium", label: "Médio" },
  { id: "high", label: "Alto" },
  { id: "xhigh", label: "Máximo" },
];

// janela de contexto por modelo (tokens). Default 200k para a família Claude.
const CONTEXT_WINDOW: Record<string, number> = {
  "claude-opus-4-8": 200_000,
  "claude-sonnet-4-6": 200_000,
  "claude-haiku-4-5-20251001": 200_000,
};
function contextWindowFor(model: string) {
  return CONTEXT_WINDOW[model] ?? 200_000;
}

const MODELS = [
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6" },
  { id: "claude-opus-4-8", label: "Opus 4.8" },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
];

// ícone por tool (lucide). default: engrenagem.
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

function ToolUseBlock({ message }: { message: Message }) {
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

// Botão de copiar reutilizável (recebe o texto cru).
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button
      type="button"
      onClick={copy}
      className="absolute top-2 right-2 z-10 flex items-center gap-1 text-[10px] bg-gray-700/90 text-gray-100 rounded px-2 py-0.5 opacity-0 group-hover:opacity-100 transition"
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {copied ? "copiado" : "copiar"}
    </button>
  );
}

// Realça código com Shiki (engine do VS Code). Debounce curto para não
// re-highlightar a cada token durante o streaming. Fallback: <pre> cru.
function useShikiHtml(code: string, lang?: string) {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const id = setTimeout(() => {
      codeToHtml(code, { lang: lang || "text", theme: "github-dark" })
        .then((h) => active && setHtml(h))
        .catch(() => active && setHtml(null)); // lang desconhecida -> fallback
    }, 80);
    return () => {
      active = false;
      clearTimeout(id);
    };
  }, [code, lang]);
  return html;
}

// Bloco de código (Shiki) + botão copiar; inline-code fica como <code> simples.
// Heurística inline: sem classe language-* e sem quebra de linha.
function CodeHighlight({ className, children, ...props }: any) {
  const raw = String(children ?? "");
  const match = /language-(\w+)/.exec(className || "");
  const language = match ? match[1] : undefined;
  const isInline = !language && !raw.includes("\n");

  if (isInline) {
    return <code className={className} {...props}>{children}</code>;
  }

  const code = raw.replace(/\n$/, "");
  const html = useShikiHtml(code, language);
  return (
    <div className="relative group my-2 text-xs">
      <CopyButton text={code} />
      {html ? (
        <div
          className="rounded-lg overflow-hidden [&_pre]:!m-0 [&_pre]:px-4 [&_pre]:py-3 [&_pre]:overflow-x-auto"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className="rounded-lg bg-gray-900 text-gray-100 px-4 py-3 overflow-x-auto">
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
}

// Command palette (Ctrl+K): busca arquivos do projeto + ações rápidas.
type PaletteItem = { label: string; hint?: string; run: () => void };
function CommandPalette({
  files,
  onPickFile,
  onNewChat,
  onOpenPanel,
  onClose,
}: {
  files: string[];
  onPickFile: (f: string) => void;
  onNewChat: () => void;
  onOpenPanel: (tab: "tools" | "tasks" | "git") => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);

  const actions: PaletteItem[] = [
    { label: "Novo chat", hint: "ação", run: onNewChat },
    { label: "Abrir painel Git", hint: "ação", run: () => onOpenPanel("git") },
    { label: "Abrir painel Ferramentas", hint: "ação", run: () => onOpenPanel("tools") },
    { label: "Abrir painel Tarefas", hint: "ação", run: () => onOpenPanel("tasks") },
  ];
  const ql = q.toLowerCase();
  const actionItems = actions.filter((a) => a.label.toLowerCase().includes(ql));
  const fileItems: PaletteItem[] = files
    .filter((f) => f.toLowerCase().includes(ql))
    .slice(0, 30)
    .map((f) => ({ label: f, hint: "arquivo", run: () => onPickFile(f) }));
  const items = [...actionItems, ...fileItems];
  const clamped = Math.min(idx, Math.max(0, items.length - 1));

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-black/30" onClick={onClose}>
      <div className="w-full max-w-lg bg-white rounded-lg shadow-2xl border border-gray-200 overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-3 border-b border-gray-100">
          <Search className="w-4 h-4 text-gray-400 shrink-0" />
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setIdx(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setIdx((i) => Math.min(i + 1, items.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIdx((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                items[clamped]?.run();
              } else if (e.key === "Escape") {
                onClose();
              }
            }}
            placeholder="Buscar arquivos e ações…"
            className="flex-1 py-3 text-sm focus:outline-none"
          />
          <span className="text-[10px] text-gray-300 shrink-0">Esc</span>
        </div>
        <div className="max-h-72 overflow-y-auto py-1">
          {items.length === 0 ? (
            <p className="px-3 py-4 text-xs text-gray-400">Nada encontrado.</p>
          ) : (
            items.map((it, i) => (
              <button
                key={it.hint + it.label}
                type="button"
                onMouseEnter={() => setIdx(i)}
                onClick={() => it.run()}
                className={`w-full flex items-center justify-between gap-2 px-3 py-1.5 text-left ${i === clamped ? "bg-blue-50" : "hover:bg-gray-50"}`}
              >
                <span className="text-xs font-mono text-gray-700 truncate">{it.label}</span>
                <span className="text-[10px] text-gray-400 shrink-0">{it.hint}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// Card de delegação inline (Task / consulta ao guardião) — estilo opencode.
function SubAgentCard({ message }: { message: Message }) {
  const input = message.toolInput || {};
  const isGuardian = message.toolName?.startsWith("mcp__consultor__");
  const name = isGuardian ? "guardião" : input.subagent_type || "subagente";
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

// Bloco de raciocínio (extended thinking) — colapsável, dim, expande durante o stream.
function ThinkingBlock({ message }: { message: Message }) {
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

function MessageBubble({ message, modelLabel }: { message: Message; modelLabel?: string }) {
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

export function ChatWindow({
  chatId,
  messages,
  isConnected,
  isLoading,
  onSendMessage,
  onStop,
  model,
  onModelChange,
  effort,
  onEffortChange,
  cwd,
  onCwdChange,
  agentStatus,
  lastResult,
  onNewChat,
  onOpenPanel,
  onCompact,
  recentProjects,
  onOpenProject,
}: ChatWindowProps) {
  const modelLabel = MODELS.find((m) => m.id === model)?.label ?? model;
  const [input, setInput] = useState("");
  const [files, setFiles] = useState<string[]>([]);
  const [mention, setMention] = useState<string | null>(null); // query do @ ou null
  const [images, setImages] = useState<{ media_type: string; data: string; url: string }[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false); // command palette (Ctrl+K)
  const [enhancing, setEnhancing] = useState(false); // ✨ prompt enhancer rodando
  const [openPath, setOpenPath] = useState(""); // input "Abrir projeto" na tela inicial
  const [browse, setBrowse] = useState<{ path: string; dirs: string[] }>({ path: "", dirs: [] });
  const [browseOpen, setBrowseOpen] = useState(false); // dropdown de diretórios aberto
  const enhanceOriginalRef = useRef<string | null>(null); // rascunho antes do ✨ (p/ aprender)
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // tipos/tamanho aceitos (espelham o uploads.ts do servidor) — feedback imediato no cliente
  const ACCEPTED_IMAGE = ["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp"];
  const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

  // colar imagem (Ctrl+V) -> valida tipo/tamanho, lê como base64 e anexa
  const onPaste = (e: React.ClipboardEvent) => {
    for (const item of e.clipboardData.items) {
      if (!item.type.startsWith("image/")) continue;
      const blob = item.getAsFile();
      if (!blob) continue;
      if (!ACCEPTED_IMAGE.includes(blob.type)) {
        toast.error(`Tipo não suportado: ${blob.type}. Aceitos: PNG, JPEG, GIF, WebP.`);
        continue;
      }
      if (blob.size > MAX_IMAGE_BYTES) {
        toast.error(`Imagem muito grande: ${(blob.size / 1024 / 1024).toFixed(1)} MB. Limite: 10 MB.`);
        continue;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const url = reader.result as string; // data:image/png;base64,XXXX
        const data = url.split(",")[1] ?? "";
        const media_type = url.match(/data:(.*?);/)?.[1] || "image/png";
        setImages((prev) => [...prev, { media_type, data, url }]);
      };
      reader.onerror = () => toast.error("Falha ao ler a imagem colada.");
      reader.readAsDataURL(blob);
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // carrega a lista de arquivos do projeto (para o autocomplete @) — segue o cwd
  useEffect(() => {
    const q = cwd.trim() ? `?cwd=${encodeURIComponent(cwd.trim())}` : "";
    fetch(`/api/files${q}`)
      .then((r) => r.json())
      .then((d) => setFiles(d.files || []))
      .catch(() => {});
  }, [cwd]);

  // navegador de diretórios do "Abrir projeto": lista subdirs do caminho digitado
  useEffect(() => {
    if (!browseOpen) return;
    const id = setTimeout(() => {
      fetch(`/api/browse?path=${encodeURIComponent(openPath)}`)
        .then((r) => r.json())
        .then((d) => setBrowse({ path: d.path || "", dirs: d.dirs || [] }))
        .catch(() => {});
    }, 120);
    return () => clearTimeout(id);
  }, [openPath, browseOpen]);

  // Ctrl/Cmd+K abre/fecha o command palette
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // insere um arquivo escolhido no palette como menção @ no input
  const insertFileMention = (file: string) => {
    setInput((cur) => (cur.trim() ? cur.replace(/\s*$/, " ") : "") + `@${file} `);
    setPaletteOpen(false);
    inputRef.current?.focus();
  };

  // detecta um @ + texto no fim do input -> abre o picker filtrado
  const onInputChange = (value: string) => {
    setInput(value);
    if (value.trim() === "") enhanceOriginalRef.current = null; // limpou tudo -> esquece o rascunho do ✨
    const m = value.match(/@([^\s]*)$/);
    setMention(m ? m[1] : null);
  };

  const matches = mention !== null ? files.filter((f) => f.toLowerCase().includes(mention.toLowerCase())).slice(0, 8) : [];

  const pickFile = (file: string) => {
    setInput((cur) => cur.replace(/@[^\s]*$/, `@${file} `));
    setMention(null);
    inputRef.current?.focus();
  };

  // slash-commands: ativos quando o input é só "/" + uma palavra (sem espaço ainda)
  const COMMANDS: { cmd: string; desc: string; run?: () => void; insert?: string }[] = [
    { cmd: "/clear", desc: "Novo chat (limpa o contexto)", run: () => onNewChat() },
    { cmd: "/git", desc: "Abrir painel de alterações (Git)", run: () => onOpenPanel("git") },
    { cmd: "/tools", desc: "Abrir painel de ferramentas", run: () => onOpenPanel("tools") },
    { cmd: "/tarefas", desc: "Abrir painel de tarefas", run: () => onOpenPanel("tasks") },
    { cmd: "/compact", desc: "Compactar o contexto da conversa", run: () => onCompact() },
    { cmd: "/guardian", desc: "Perguntar ao guardião (docs do Agent SDK)", insert: "Consulte o guardião: " },
  ];
  const slashQuery = /^\/(\S*)$/.exec(input)?.[1] ?? null;
  const slashMatches = slashQuery !== null ? COMMANDS.filter((c) => c.cmd.slice(1).startsWith(slashQuery.toLowerCase())) : [];

  const runCommand = (c: (typeof COMMANDS)[number]) => {
    if (c.run) {
      c.run();
      setInput("");
    } else if (c.insert) {
      setInput(c.insert);
      inputRef.current?.focus();
    }
  };

  // ✨ prompt enhancer: reescreve o rascunho num prompt melhor (volta pro input).
  const enhanceInput = async () => {
    const text = input.trim();
    if (!text || enhancing) return;
    setEnhancing(true);
    try {
      const res = await fetch("/api/enhance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }), // mode omitido = auto-detecção
      });
      // checa res.ok antes do .json(): respostas não-JSON (413, proxy) não quebram o parser
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        toast.error(`Enhancer falhou (${res.status})${detail ? `: ${detail.slice(0, 120)}` : ""}`);
        return;
      }
      const data = await res.json();
      if (data.improvedPrompt) {
        enhanceOriginalRef.current = text; // guarda o rascunho original p/ aprender ao enviar
        setInput(data.improvedPrompt);
        toast.success("Prompt melhorado ✨");
        inputRef.current?.focus();
      } else {
        toast.error(data.error || "Não consegui melhorar o prompt.");
      }
    } catch {
      toast.error("Falha ao chamar o enhancer.");
    } finally {
      setEnhancing(false);
    }
  };

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if ((!input.trim() && images.length === 0) || !chatId || isLoading || !isConnected) return;
    // se o texto veio do ✨, manda o rascunho original junto (o server aprende o par)
    const enhancedFrom = enhanceOriginalRef.current || undefined;
    onSendMessage(input.trim(), images.map(({ media_type, data }) => ({ media_type, data })), enhancedFrom);
    enhanceOriginalRef.current = null;
    setInput("");
    setMention(null);
    setImages([]);
  };

  if (!chatId) {
    const submitOpenPath = () => {
      const p = openPath.trim();
      if (p) {
        onOpenProject(p);
        setOpenPath("");
      }
    };
    // fragmento sendo digitado (após a última "/") e subdirs filtrados pra navegação
    const frag = openPath.slice(openPath.lastIndexOf("/") + 1).toLowerCase();
    const dirMatches = (browseOpen ? browse.dirs : []).filter((d) => d.toLowerCase().startsWith(frag)).slice(0, 12);
    const drillInto = (name: string) => {
      const base = browse.path.replace(/\/$/, "");
      setOpenPath(`${base}/${name}/`); // desce um nível; o effect refaz o browse
    };
    return (
      <div className="flex-1 overflow-y-auto bg-gray-50">
        <div className="max-w-xl mx-auto px-6 py-12">
          <div className="flex items-center gap-3 mb-1">
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-blue-50 text-blue-600">
              <Folder className="w-5 h-5" />
            </div>
            <div>
              <p className="text-lg font-semibold text-gray-800">my-agent-chat</p>
              <p className="text-xs text-gray-400">Abra um projeto ou retome um recente.</p>
            </div>
          </div>

          {/* Abrir projeto: cola/digita um caminho */}
          <div className="mt-6">
            <label className="text-xs font-medium text-gray-500 flex items-center gap-1.5 mb-1.5">
              <FolderOpen className="w-3.5 h-3.5" /> Abrir projeto
            </label>
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <input
                  type="text"
                  value={openPath}
                  onChange={(e) => setOpenPath(e.target.value)}
                  onFocus={async () => {
                    setBrowseOpen(true);
                    if (!openPath.trim()) {
                      try {
                        const d = await (await fetch("/api/browse")).json();
                        setOpenPath(`${d.path || ""}/`); // começa no home
                      } catch {
                        /* ignore */
                      }
                    }
                  }}
                  onBlur={() => setTimeout(() => setBrowseOpen(false), 150)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitOpenPath();
                    else if (e.key === "Escape") setBrowseOpen(false);
                  }}
                  placeholder="/caminho/do/projeto  (digite / para navegar)"
                  spellCheck={false}
                  className="w-full text-sm font-mono border border-gray-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {/* dropdown de subdiretórios */}
                {browseOpen && dirMatches.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto z-10">
                    {dirMatches.map((d) => (
                      <button
                        key={d}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault(); // mantém o foco no input
                          drillInto(d);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs font-mono text-gray-700 hover:bg-blue-50"
                      >
                        <Folder className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                        <span className="truncate">{d}/</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                onClick={submitOpenPath}
                disabled={!openPath.trim()}
                className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors text-sm shrink-0"
              >
                Abrir <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Projetos recentes */}
          <div className="mt-7">
            <p className="text-xs font-medium text-gray-500 mb-2">Projetos recentes</p>
            {recentProjects.length === 0 ? (
              <p className="text-xs text-gray-400">Nenhum ainda — abra um projeto acima para começar.</p>
            ) : (
              <div className="space-y-1">
                {recentProjects.map((p) => (
                  <button
                    key={p.path}
                    onClick={() => onOpenProject(p.path)}
                    className="group w-full flex items-center gap-3 px-3 py-2 rounded-lg border border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-50/40 transition-colors text-left"
                  >
                    <Folder className="w-4 h-4 text-gray-400 group-hover:text-blue-500 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-800 truncate">{p.name}</span>
                        {p.branch && (
                          <span className="flex items-center gap-0.5 text-[10px] text-gray-400 shrink-0">
                            <GitBranch className="w-3 h-3" />
                            {p.branch}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] font-mono text-gray-400 truncate">{p.path}</div>
                    </div>
                    <span className="text-[10px] text-gray-400 shrink-0">{relTime(p.lastOpenedAt)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <p className="text-xs text-gray-400 mt-7">Ou selecione um chat na barra lateral.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-white">
      {paletteOpen && (
        <CommandPalette
          files={files}
          onPickFile={insertFileMention}
          onNewChat={() => {
            onNewChat();
            setPaletteOpen(false);
          }}
          onOpenPanel={(t) => {
            onOpenPanel(t);
            setPaletteOpen(false);
          }}
          onClose={() => setPaletteOpen(false)}
        />
      )}
      {/* Header */}
      <div className="px-4 py-2 border-b border-gray-200 flex items-center justify-between gap-3">
        <div className="min-w-0 flex items-center gap-2">
          <Folder className="w-3.5 h-3.5 text-gray-500 shrink-0" />
          <span className="font-mono text-xs text-gray-700 truncate" title={cwd || "(diretório do servidor)"}>
            {cwd ? cwd.replace(/\/$/, "").split("/").pop() : "my-agent"}
          </span>
          <span className="text-[10px] text-gray-400 shrink-0">{modelLabel}</span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {/* medidor de uso da janela de contexto (input do último turno / janela do modelo) */}
          {lastResult?.inputTokens != null && (() => {
            const win = contextWindowFor(model);
            const pct = Math.min(100, (lastResult.inputTokens! / win) * 100);
            const color = pct > 85 ? "bg-red-500" : pct > 60 ? "bg-amber-500" : "bg-blue-500";
            return (
              <span className="flex items-center gap-1.5 text-[10px] text-gray-400" title={`contexto: ${lastResult.inputTokens!.toLocaleString()} / ${win.toLocaleString()} tokens`}>
                <span className="w-16 h-1.5 rounded-full bg-gray-200 overflow-hidden">
                  <span className={`block h-full ${color}`} style={{ width: `${pct}%` }} />
                </span>
                {Math.round(pct)}%
              </span>
            );
          })()}
          {lastResult && (
            <span className="text-[10px] text-gray-400" title="último turno">
              {lastResult.cost != null && `$${lastResult.cost.toFixed(4)}`}
              {lastResult.duration != null && ` · ${(lastResult.duration / 1000).toFixed(1)}s`}
            </span>
          )}
          <span className={`flex items-center gap-1 text-xs ${isConnected ? "text-green-600" : "text-red-600"}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? "bg-green-500" : "bg-red-500"}`} />
            {isConnected ? "Connected" : "Disconnected"}
          </span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
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
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t border-gray-200 relative">
        {/* picker de arquivos (@) */}
        {matches.length > 0 && (
          <div className="absolute bottom-full left-4 right-4 mb-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-y-auto z-10">
            {matches.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => pickFile(f)}
                className="w-full text-left px-3 py-1.5 text-xs font-mono text-gray-700 hover:bg-blue-50"
              >
                {f}
              </button>
            ))}
          </div>
        )}
        {/* menu de slash-commands (/) */}
        {slashMatches.length > 0 && (
          <div className="absolute bottom-full left-4 right-4 mb-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-y-auto z-10">
            {slashMatches.map((c, i) => (
              <button
                key={c.cmd}
                type="button"
                onClick={() => runCommand(c)}
                className={`w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-blue-50 ${i === 0 ? "bg-blue-50/50" : ""}`}
              >
                <span className="text-xs font-mono font-semibold text-blue-600 shrink-0">{c.cmd}</span>
                <span className="text-[11px] text-gray-500 truncate">{c.desc}</span>
              </button>
            ))}
          </div>
        )}
        <div className="mb-1 flex items-center gap-2">
          <span className="text-xs text-gray-400">modelo:</span>
          <select
            value={model}
            onChange={(e) => onModelChange(e.target.value)}
            className="text-xs border border-gray-300 rounded px-2 py-1 bg-white text-gray-700 focus:outline-none"
          >
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <span className="text-xs text-gray-400 ml-1">raciocínio:</span>
          <select
            value={effort}
            onChange={(e) => onEffortChange(e.target.value)}
            className="text-xs border border-gray-300 rounded px-2 py-1 bg-white text-gray-700 focus:outline-none"
            title="nível de esforço de raciocínio (extended thinking)"
          >
            {EFFORTS.map((ef) => (
              <option key={ef.id} value={ef.id}>
                {ef.label}
              </option>
            ))}
          </select>
          <span className="text-[10px] text-gray-400">trocar reinicia o contexto</span>
        </div>
        <div className="mb-2 flex items-center gap-2">
          <span className="text-xs text-gray-400 shrink-0">diretório:</span>
          <input
            type="text"
            value={cwd}
            onChange={(e) => onCwdChange(e.target.value)}
            className="flex-1 text-xs font-mono border border-gray-300 rounded px-2 py-1 bg-white text-gray-700 focus:outline-none focus:border-blue-400"
            placeholder="/caminho/do/projeto"
            spellCheck={false}
          />
        </div>
        {/* preview das imagens coladas */}
        {images.length > 0 && (
          <div className="mb-2 flex gap-2 flex-wrap">
            {images.map((img, i) => (
              <div key={i} className="relative">
                <img src={img.url} alt="anexo" className="h-16 w-16 object-cover rounded border border-gray-300" />
                <button
                  type="button"
                  onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                  className="absolute -top-1.5 -right-1.5 bg-gray-700 text-white rounded-full w-4 h-4 flex items-center justify-center"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </div>
            ))}
          </div>
        )}
        <form onSubmit={handleSubmit} className="flex gap-2 items-end">
          <TextareaAutosize
            ref={inputRef}
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onPaste={onPaste}
            onKeyDown={(e) => {
              // Enter envia; Shift+Enter quebra linha (ignora durante composição IME)
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                // menu de slash aberto -> executa o 1º comando em vez de enviar
                if (slashMatches.length > 0) {
                  runCommand(slashMatches[0]);
                  return;
                }
                handleSubmit();
              }
            }}
            minRows={1}
            maxRows={8}
            placeholder={isConnected ? "Mensagem... (@ arquivos · cole imagem · Shift+Enter quebra linha)" : "Connecting..."}
            disabled={!isConnected || isLoading}
            className="flex-1 resize-none px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100"
          />
          <button
            type="button"
            onClick={enhanceInput}
            disabled={!input.trim() || enhancing || isLoading}
            title="Melhorar o prompt (✨)"
            className="flex items-center justify-center w-10 py-2 rounded-lg border border-gray-300 text-violet-600 hover:bg-violet-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
          >
            {enhancing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
          </button>
          {isLoading ? (
            <button
              type="button"
              onClick={onStop}
              className="flex items-center gap-1.5 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors shrink-0"
            >
              <Square className="w-4 h-4" /> Parar
            </button>
          ) : (
            <button
              type="submit"
              disabled={(!input.trim() && images.length === 0) || !isConnected}
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
            >
              <Send className="w-4 h-4" /> Send
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
