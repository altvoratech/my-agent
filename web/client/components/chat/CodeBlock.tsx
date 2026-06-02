import { useState, useEffect } from "react";
import { codeToHtml } from "shiki";
import { Copy, Check } from "lucide-react";

export function CopyButton({ text }: { text: string }) {
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
export function CodeHighlight({ className, children, ...props }: any) {
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
