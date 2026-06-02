import React, { useState, useRef, useEffect } from "react";
import TextareaAutosize from "react-textarea-autosize";
import { toast } from "sonner";
import { Send, Square, X, Wand2, Loader2 } from "lucide-react";
import { enhance } from "../../lib/api";
import { EFFORTS, MODELS } from "./constants";
import { CommandPalette } from "./CommandPalette";

interface ComposerProps {
  onSend: (content: string, images?: { media_type: string; data: string }[], enhancedFrom?: string) => void;
  onStop: () => void;
  onTest: (instruction?: string) => void;
  onCompact: () => void;
  onNewChat: () => void;
  onOpenPanel: (tab: "tools" | "tasks" | "git") => void;
  isLoading: boolean;
  isConnected: boolean;
  files: string[];
  // controles de sessão (ficam no rodapé, perto do input — como no original)
  model: string;
  onModelChange: (model: string) => void;
  effort: string;
  onEffortChange: (e: string) => void;
  cwd: string;
  onCwdChange: (cwd: string) => void;
}

export function Composer({
  onSend,
  onStop,
  onTest,
  onCompact,
  onNewChat,
  onOpenPanel,
  isLoading,
  isConnected,
  files,
  model,
  onModelChange,
  effort,
  onEffortChange,
  cwd,
  onCwdChange,
}: ComposerProps) {
  const [input, setInput] = useState("");
  const [mention, setMention] = useState<string | null>(null); // query do @ ou null
  const [images, setImages] = useState<{ media_type: string; data: string; url: string }[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false); // command palette (Ctrl+K)
  const [enhancing, setEnhancing] = useState(false); // ✨ prompt enhancer rodando
  const enhanceOriginalRef = useRef<string | null>(null); // rascunho antes do ✨ (p/ aprender)
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
    { cmd: "/test", desc: "Rodar testes e typecheck (libera o Bash)", run: () => onTest() },
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
      const data = await enhance(text); // mode omitido = auto-detecção
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
    if ((!input.trim() && images.length === 0) || isLoading || !isConnected) return;
    // "/test <instrução>": dispara o tester com foco, sem virar mensagem da conversa
    const testMatch = /^\/test\b\s*(.*)$/s.exec(input.trim());
    if (testMatch) {
      onTest(testMatch[1].trim() || undefined);
      setInput("");
      return;
    }
    // se o texto veio do ✨, manda o rascunho original junto (o server aprende o par)
    const enhancedFrom = enhanceOriginalRef.current || undefined;
    onSend(input.trim(), images.map(({ media_type, data }) => ({ media_type, data })), enhancedFrom);
    enhanceOriginalRef.current = null;
    setInput("");
    setMention(null);
    setImages([]);
  };

  return (
    <>
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
        {/* pickers de modelo / esforço de raciocínio */}
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

        {/* picker de diretório (cwd) */}
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
    </>
  );
}
