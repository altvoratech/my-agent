import { useState } from "react";
import { Search } from "lucide-react";

type PaletteItem = { label: string; hint?: string; run: () => void };
export function CommandPalette({
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
