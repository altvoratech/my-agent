import { useState, useEffect, useCallback } from "react";
import { getProjects } from "../lib/api";

// projeto recente exibido no Launcher (mesmo shape usado hoje no App)
export type RecentProject = {
  path: string;
  name: string;
  lastOpenedAt: string;
  branch: string;
};

// useProjects: lista de projetos recentes (REST via lib/api.getProjects)
export function useProjects() {
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);

  const refresh = useCallback(async () => {
    try {
      const data = await getProjects();
      setRecentProjects(data.projects || []);
    } catch (error) {
      console.error("Failed to fetch projects:", error);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { recentProjects, refresh };
}
