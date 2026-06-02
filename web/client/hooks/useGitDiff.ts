import { useState, useCallback } from "react";
import { getGitDiff } from "../lib/api";

// estado do git diff (diff/status/numstat) para o cwd atual
export type GitState = { diff: string; status: string; numstat: string };

// hook do painel Git: replica o fetchGitDiff do App.
// busca o diff do cwd via lib/api.getGitDiff e expõe { git, refresh }.
export function useGitDiff(cwd: string) {
  const [git, setGit] = useState<GitState>({ diff: "", status: "", numstat: "" });

  const refresh = useCallback(async () => {
    // getGitDiff já trata erro e retorna o shape vazio coerente
    const data = await getGitDiff(cwd);
    setGit({ diff: data.diff || "", status: data.status || "", numstat: data.numstat || "" });
  }, [cwd]);

  return { git, refresh };
}
