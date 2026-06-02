import React, { useState, useEffect } from "react";
import { Folder, FolderOpen, ArrowRight, GitBranch } from "lucide-react";
import { relTime } from "../components/chat/constants";

interface LauncherProps {
  recentProjects: { path: string; name: string; lastOpenedAt: string; branch: string }[];
  onOpenProject: (path: string) => void;
}

export function Launcher({ recentProjects, onOpenProject }: LauncherProps) {
  const [openPath, setOpenPath] = useState(""); // input "Abrir projeto" na tela inicial
  const [browse, setBrowse] = useState<{ path: string; dirs: string[] }>({ path: "", dirs: [] });
  const [browseOpen, setBrowseOpen] = useState(false); // dropdown de diretórios aberto

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
