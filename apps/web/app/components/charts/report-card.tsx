"use client";

import { useEffect, useState, useCallback } from "react";
import { ChartPanel } from "./chart-panel";
import type { ReportConfig, PanelConfig } from "./types";

type ReportCardProps = {
  config: ReportConfig;
};

// --- Icons ---

function ChartBarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" x2="12" y1="20" y2="10" />
      <line x1="18" x2="18" y1="20" y2="4" />
      <line x1="6" x2="6" y1="20" y2="14" />
    </svg>
  );
}

function ExternalLinkIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" x2="21" y1="14" y2="3" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" x2="12" y1="17" y2="22" />
      <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" />
    </svg>
  );
}

// --- Panel data state ---

type PanelData = {
  rows: Record<string, unknown>[];
  loading: boolean;
  error?: string;
};

// --- Main ReportCard ---

export function ReportCard({ config }: ReportCardProps) {
  const [panelData, setPanelData] = useState<Record<string, PanelData>>({});
  const [pinning, setPinning] = useState(false);
  const [pinned, setPinned] = useState(false);

  // Show at most 2 panels inline
  const visiblePanels = config.panels.slice(0, 2);

  // Execute panel SQL queries
  const executePanels = useCallback(async () => {
    const initial: Record<string, PanelData> = {};
    for (const panel of visiblePanels) {
      initial[panel.id] = { rows: [], loading: true };
    }
    setPanelData(initial);

    await Promise.all(
      visiblePanels.map(async (panel) => {
        try {
          const res = await fetch("/api/workspace/reports/execute", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sql: panel.sql }),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            setPanelData((prev) => ({
              ...prev,
              [panel.id]: { rows: [], loading: false, error: data.error || `HTTP ${res.status}` },
            }));
            return;
          }
          const data = await res.json();
          setPanelData((prev) => ({
            ...prev,
            [panel.id]: { rows: data.rows ?? [], loading: false },
          }));
        } catch (err) {
          setPanelData((prev) => ({
            ...prev,
            [panel.id]: { rows: [], loading: false, error: err instanceof Error ? err.message : "Failed" },
          }));
        }
      }),
    );
  }, [visiblePanels]);

  useEffect(() => {
    executePanels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pin report to workspace filesystem
  const handlePin = async () => {
    setPinning(true);
    try {
      const slug = config.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40);
      const filename = `${slug}.report.json`;

      await fetch("/api/workspace/file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: `reports/${filename}`,
          content: JSON.stringify(config, null, 2),
        }),
      });
      setPinned(true);
    } catch {
      // silently fail
    } finally {
      setPinning(false);
    }
  };

  return (
    <div
      className="rounded-xl overflow-hidden my-2"
      style={{
        background: "var(--color-bg)",
        border: "1px solid var(--color-border)",
        maxWidth: "100%",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2 border-b"
        style={{ borderColor: "var(--color-border)" }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span style={{ color: "#22c55e" }}>
            <ChartBarIcon />
          </span>
          <span
            className="text-sm font-medium truncate"
            style={{ color: "var(--color-text)" }}
          >
            {config.title}
          </span>
          <span
            className="text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0"
            style={{
              background: "rgba(34, 197, 94, 0.1)",
              color: "#22c55e",
            }}
          >
            {config.panels.length} chart{config.panels.length !== 1 ? "s" : ""}
          </span>
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          {!pinned && (
            <button
              type="button"
              onClick={handlePin}
              disabled={pinning}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] transition-colors cursor-pointer disabled:opacity-40"
              style={{
                color: "var(--color-text-muted)",
                background: "var(--color-surface)",
                border: "1px solid var(--color-border)",
              }}
              title="Save to workspace"
            >
              <PinIcon />
              {pinning ? "Saving..." : "Pin"}
            </button>
          )}
          {pinned && (
            <span
              className="text-[10px] px-2 py-1 rounded-md"
              style={{ color: "#22c55e", background: "rgba(34, 197, 94, 0.1)" }}
            >
              Saved
            </span>
          )}
          <a
            href="/workspace"
            className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] transition-colors"
            style={{
              color: "var(--color-accent)",
              background: "var(--color-accent-light)",
            }}
          >
            <ExternalLinkIcon />
            Open
          </a>
        </div>
      </div>

      {/* Description */}
      {config.description && (
        <div className="px-3 py-1.5">
          <p className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>
            {config.description}
          </p>
        </div>
      )}

      {/* Panels (compact mode) */}
      <div className={`grid gap-2 p-2 ${visiblePanels.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
        {visiblePanels.map((panel) => (
          <CompactPanelCard
            key={panel.id}
            panel={panel}
            data={panelData[panel.id]}
          />
        ))}
      </div>

      {/* More panels indicator */}
      {config.panels.length > 2 && (
        <div
          className="px-3 py-1.5 text-center border-t"
          style={{ borderColor: "var(--color-border)" }}
        >
          <span className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
            +{config.panels.length - 2} more chart{config.panels.length - 2 !== 1 ? "s" : ""}
          </span>
        </div>
      )}
    </div>
  );
}

// --- Compact panel card for inline rendering ---

function CompactPanelCard({
  panel,
  data,
}: {
  panel: PanelConfig;
  data?: PanelData;
}) {
  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
      }}
    >
      <div className="px-2.5 py-1.5">
        <h4
          className="text-[11px] font-medium truncate"
          style={{ color: "var(--color-text)" }}
        >
          {panel.title}
        </h4>
      </div>
      <div className="px-1 pb-1">
        {data?.loading ? (
          <div className="flex items-center justify-center" style={{ height: 200 }}>
            <div
              className="w-4 h-4 border-2 rounded-full animate-spin"
              style={{
                borderColor: "var(--color-border)",
                borderTopColor: "var(--color-accent)",
              }}
            />
          </div>
        ) : data?.error ? (
          <div className="flex items-center justify-center" style={{ height: 200 }}>
            <p className="text-[10px]" style={{ color: "#f87171" }}>
              {data.error}
            </p>
          </div>
        ) : (
          <ChartPanel config={panel} data={data?.rows ?? []} compact />
        )}
      </div>
    </div>
  );
}
