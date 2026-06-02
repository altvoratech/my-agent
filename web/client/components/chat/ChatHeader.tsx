import { Folder } from "lucide-react";
import { MODELS, contextWindowFor } from "./constants";

// Barra de status fina no TOPO: projeto + modelo + medidor de contexto + conexão.
// Os pickers de modelo/raciocínio e o diretório ficam no Composer (rodapé), perto do input.
interface ChatHeaderProps {
  model: string;
  cwd: string;
  isConnected: boolean;
  lastResult: { cost?: number; duration?: number; inputTokens?: number; outputTokens?: number } | null;
}

export function ChatHeader({ model, cwd, isConnected, lastResult }: ChatHeaderProps) {
  const modelLabel = MODELS.find((m) => m.id === model)?.label ?? model;

  return (
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
  );
}
