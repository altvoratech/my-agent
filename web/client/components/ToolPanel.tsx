import { useState } from "react";

// Teto de eventos: mantém só os mais recentes (painel não cresce infinito).
export const MAX_TOOL_EVENTS = 150;

export type PanelEvent =
  | { id: string; kind: "tool"; toolName: string; toolInput?: Record<string, any>; timestamp: string }
  | { id: string; kind: "guard"; tool: string; reason: string; timestamp: string }
  | { id: string; kind: "prefetch"; hits: number; sources: string[]; timestamp: string };

function toolMeta(name: string): { emoji: string; label: string } {
  if (name.startsWith("mcp__consultor__")) return { emoji: "🤖", label: "guardião" };
  if (name.startsWith("mcp__")) return { emoji: "🔌", label: name.split("__").slice(1).join("·") };
  const map: Record<string, { emoji: string; label: string }> = {
    Read: { emoji: "📄", label: "Read" },
    Write: { emoji: "📝", label: "Write" },
    Edit: { emoji: "✏️", label: "Edit" },
    MultiEdit: { emoji: "✏️", label: "MultiEdit" },
    Bash: { emoji: "💻", label: "Bash" },
    Glob: { emoji: "🔍", label: "Glob" },
    Grep: { emoji: "🔍", label: "Grep" },
    WebSearch: { emoji: "🌐", label: "WebSearch" },
    WebFetch: { emoji: "🌐", label: "WebFetch" },
    ToolSearch: { emoji: "🔎", label: "ToolSearch" },
  };
  return map[name] ?? { emoji: "🔧", label: name };
}

function summarize(name: string, input: Record<string, any> = {}): string {
  if (name.startsWith("mcp__consultor__")) return input.pergunta ?? "";
  switch (name) {
    case "Read":
    case "Write":
    case "Edit":
    case "MultiEdit":
      return input.file_path ?? "";
    case "Bash":
      return input.command ?? "";
    case "Grep":
      return `"${input.pattern}" em ${input.path ?? "."}`;
    case "Glob":
      return input.pattern ?? "";
    case "WebSearch":
    case "ToolSearch":
      return input.query ?? "";
    case "WebFetch":
      return input.url ?? "";
    default:
      return JSON.stringify(input).slice(0, 80);
  }
}

function Row({ event }: { event: PanelEvent }) {
  const [open, setOpen] = useState(false);
  const time = event.timestamp.slice(11, 19);

  // estilo por tipo
  let emoji: string, label: string, detail: string, accent: string, body: any;
  if (event.kind === "guard") {
    emoji = "⛔";
    label = `Bloqueado · ${event.tool}`;
    detail = event.reason;
    accent = "text-red-700";
    body = event.reason;
  } else if (event.kind === "prefetch") {
    emoji = "📚";
    label = "Prefetch (ancoragem)";
    detail = `${event.hits} trechos · ${event.sources.join(", ")}`;
    accent = "text-amber-700";
    body = event.sources.join("\n");
  } else {
    const m = toolMeta(event.toolName);
    emoji = m.emoji;
    label = m.label;
    detail = summarize(event.toolName, event.toolInput);
    accent = "text-gray-700";
    body = JSON.stringify(event.toolInput ?? {}, null, 2);
  }

  return (
    <div className={`border-b border-gray-100 ${event.kind === "guard" ? "bg-red-50" : ""}`}>
      <button onClick={() => setOpen((o) => !o)} className="w-full px-3 py-2 flex items-start gap-2 text-left hover:bg-gray-100">
        <span className="text-base leading-5">{emoji}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`text-xs font-semibold ${accent}`}>{label}</span>
            <span className="text-[10px] text-gray-400">{time}</span>
          </div>
          <div className="text-xs text-gray-500 truncate">{detail}</div>
        </div>
        <span className="text-[10px] text-gray-400 mt-0.5">{open ? "▼" : "▶"}</span>
      </button>
      {open && (
        <pre className="text-[11px] bg-white mx-3 mb-2 p-2 rounded border border-gray-100 max-h-64 overflow-auto whitespace-pre-wrap">
          {body}
        </pre>
      )}
    </div>
  );
}

export function ToolPanel({ events }: { events: PanelEvent[] }) {
  // mais recentes no topo (sem precisar rolar até o fim pra ver a atividade atual)
  const ordered = [...events].reverse();
  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto">
        {events.length === 0 ? (
          <p className="text-xs text-gray-400 p-3">Tools, prefetch e bloqueios do guard aparecem aqui ao vivo.</p>
        ) : (
          <>
            {ordered.map((e) => <Row key={e.id} event={e} />)}
            {events.length >= MAX_TOOL_EVENTS && (
              <p className="text-[10px] text-gray-400 px-3 py-2">Mostrando os últimos {MAX_TOOL_EVENTS} eventos.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
