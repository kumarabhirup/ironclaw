"use client";

import { useState, useEffect, useCallback, useRef } from "react";

export type TreeNode = {
  name: string;
  path: string;
  type: "object" | "document" | "folder" | "file" | "database" | "report";
  icon?: string;
  defaultView?: "table" | "kanban";
  children?: TreeNode[];
};

/**
 * Hook that fetches the workspace tree and subscribes to SSE file-change events
 * for live reactivity. Falls back to polling if SSE is unavailable.
 */
export function useWorkspaceWatcher() {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [exists, setExists] = useState(false);

  const mountedRef = useRef(true);
  const retryDelayRef = useRef(1000);

  // Fetch the tree from the API
  const fetchTree = useCallback(async () => {
    try {
      const res = await fetch("/api/workspace/tree");
      const data = await res.json();
      if (mountedRef.current) {
        setTree(data.tree ?? []);
        setExists(data.exists ?? false);
        setLoading(false);
      }
    } catch {
      if (mountedRef.current) {setLoading(false);}
    }
  }, []);

  // Manual refresh for use after mutations
  const refresh = useCallback(() => {
    fetchTree();
  }, [fetchTree]);

  // Initial fetch
  useEffect(() => {
    mountedRef.current = true;
    fetchTree();
    return () => {
      mountedRef.current = false;
    };
  }, [fetchTree]);

  // SSE subscription with auto-reconnect and polling fallback
  useEffect(() => {
    let eventSource: EventSource | null = null;
    let pollInterval: ReturnType<typeof setInterval> | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let alive = true;

    // Debounce rapid SSE events into a single tree refetch
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    function debouncedRefetch() {
      if (debounceTimer) {clearTimeout(debounceTimer);}
      debounceTimer = setTimeout(() => {
        if (alive) {fetchTree();}
      }, 300);
    }

    function connectSSE() {
      if (!alive) {return;}

      try {
        eventSource = new EventSource("/api/workspace/watch");

        eventSource.addEventListener("connected", () => {
          // Reset retry delay on successful connection
          retryDelayRef.current = 1000;
          // Stop polling fallback if it was active
          if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
          }
        });

        eventSource.addEventListener("change", () => {
          debouncedRefetch();
        });

        eventSource.addEventListener("error", () => {
          // SSE errored -- close and schedule reconnect
          eventSource?.close();
          eventSource = null;
          scheduleReconnect();
        });

        eventSource.onerror = () => {
          eventSource?.close();
          eventSource = null;
          scheduleReconnect();
        };
      } catch {
        // SSE not supported or network error -- fall back to polling
        startPolling();
      }
    }

    function scheduleReconnect() {
      if (!alive) {return;}
      // Start polling as fallback while we wait to reconnect
      startPolling();
      const delay = retryDelayRef.current;
      retryDelayRef.current = Math.min(delay * 2, 30_000);
      reconnectTimeout = setTimeout(() => {
        if (pollInterval) {
          clearInterval(pollInterval);
          pollInterval = null;
        }
        connectSSE();
      }, delay);
    }

    function startPolling() {
      if (pollInterval || !alive) {return;}
      pollInterval = setInterval(() => {
        if (alive) {fetchTree();}
      }, 5000);
    }

    connectSSE();

    return () => {
      alive = false;
      if (eventSource) {eventSource.close();}
      if (pollInterval) {clearInterval(pollInterval);}
      if (reconnectTimeout) {clearTimeout(reconnectTimeout);}
      if (debounceTimer) {clearTimeout(debounceTimer);}
    };
  }, [fetchTree]);

  return { tree, loading, exists, refresh };
}
