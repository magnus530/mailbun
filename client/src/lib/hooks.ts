import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ServerEvent } from "@mailclient/shared";
import { api } from "./api";
import { socket } from "./socket";

export function useVaultState() {
  return useQuery({
    queryKey: ["vault", "state"],
    queryFn: api.vaultState,
    refetchOnMount: true,
    refetchInterval: 30_000,
  });
}

export function useAccounts() {
  return useQuery({ queryKey: ["accounts"], queryFn: api.accounts });
}

export function useFolders() {
  return useQuery({ queryKey: ["folders"], queryFn: api.folders });
}

export function useTags() {
  return useQuery({ queryKey: ["tags"], queryFn: api.tags });
}

export function useOAuthProviders() {
  return useQuery({
    queryKey: ["oauth", "providers"],
    queryFn: api.oauthProviders,
    staleTime: 60_000,
  });
}

export function useThreads(params: Parameters<typeof api.threads>[0]) {
  const key = ["threads", params];
  return useQuery({ queryKey: key, queryFn: () => api.threads(params) });
}

export function useThread(id: number | null) {
  return useQuery({
    queryKey: ["thread", id],
    queryFn: () => api.thread(id!),
    enabled: id != null,
  });
}

export function useServerEvents() {
  const qc = useQueryClient();
  useEffect(() => {
    socket.start();
    const off = socket.on((ev: ServerEvent) => {
      switch (ev.type) {
        case "thread:new":
        case "thread:update":
        case "thread:delete":
          qc.invalidateQueries({ queryKey: ["threads"] });
          qc.invalidateQueries({ queryKey: ["thread"] });
          qc.invalidateQueries({ queryKey: ["search"] });
          break;
        case "folder:update":
          qc.invalidateQueries({ queryKey: ["folders"] });
          // Folder counts changed because messages landed, expired, or got
          // their flags flipped — refetch the visible list too.
          qc.invalidateQueries({ queryKey: ["threads"] });
          break;
        case "sync:start":
        case "sync:done":
        case "sync:error":
          qc.invalidateQueries({ queryKey: ["accounts"] });
          // After a sync pass the list might be different even if no
          // individual thread:update fired (e.g. flags reconciled).
          if (ev.type === "sync:done") {
            qc.invalidateQueries({ queryKey: ["threads"] });
            qc.invalidateQueries({ queryKey: ["folders"] });
          }
          break;
      }
    });
    return () => { off(); };
  }, [qc]);
}
