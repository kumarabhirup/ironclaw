"use client";

import { useMemo } from "react";

type Field = {
  id: string;
  name: string;
  type: string;
  enum_values?: string[];
  enum_colors?: string[];
  related_object_name?: string;
};

type Status = {
  id: string;
  name: string;
  color?: string;
  sort_order?: number;
};

type ObjectKanbanProps = {
  objectName: string;
  fields: Field[];
  entries: Record<string, unknown>[];
  statuses: Status[];
  members?: Array<{ id: string; name: string }>;
  relationLabels?: Record<string, Record<string, string>>;
};

// --- Helpers ---

function parseRelationValue(value: string | null | undefined): string[] {
  if (!value) {return [];}
  const trimmed = value.trim();
  if (!trimmed) {return [];}
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {return parsed.map(String).filter(Boolean);}
    } catch {
      // not valid JSON
    }
  }
  return [trimmed];
}

// --- Card component ---

function KanbanCard({
  entry,
  fields,
  members,
  relationLabels,
}: {
  entry: Record<string, unknown>;
  fields: Field[];
  members?: Array<{ id: string; name: string }>;
  relationLabels?: Record<string, Record<string, string>>;
}) {
  // Show first 4 non-status fields
  const displayFields = fields
    .filter(
      (f) =>
        f.type !== "richtext" &&
        entry[f.name] !== null &&
        entry[f.name] !== undefined &&
        entry[f.name] !== "",
    )
    .slice(0, 4);

  // Find a "name" or "title" field for the card header
  const titleField = fields.find(
    (f) =>
      f.name.toLowerCase().includes("name") ||
      f.name.toLowerCase().includes("title"),
  );
  const title = titleField
    ? String(entry[titleField.name] ?? "Untitled")
    : String(entry[fields[0]?.name] ?? "Untitled");

  return (
    <div
      className="rounded-lg p-3 mb-2 transition-all duration-100 cursor-pointer"
      style={{
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor =
          "var(--color-text-muted)";
        (e.currentTarget as HTMLElement).style.transform = "translateY(-1px)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor =
          "var(--color-border)";
        (e.currentTarget as HTMLElement).style.transform = "translateY(0)";
      }}
    >
      <div
        className="text-sm font-medium mb-1.5 truncate"
        style={{ color: "var(--color-text)" }}
      >
        {title}
      </div>

      <div className="space-y-1">
        {displayFields
          .filter((f) => f !== titleField)
          .slice(0, 3)
          .map((field) => {
            const val = entry[field.name];
            if (!val) {return null;}

            // Resolve display value based on field type
            let displayVal = String(val);
            if (field.type === "user") {
              const member = members?.find((m) => m.id === displayVal);
              if (member) {displayVal = member.name;}
            } else if (field.type === "relation") {
              const fieldLabels = relationLabels?.[field.name];
              const ids = parseRelationValue(displayVal);
              const labels = ids.map((id) => fieldLabels?.[id] ?? id);
              displayVal = labels.join(", ");
            }

            return (
              <div key={field.id} className="flex items-center gap-1.5 text-xs">
                <span style={{ color: "var(--color-text-muted)" }}>
                  {field.name}:
                </span>
                {field.type === "enum" ? (
                  <EnumBadgeMini
                    value={String(val)}
                    enumValues={field.enum_values}
                    enumColors={field.enum_colors}
                  />
                ) : field.type === "relation" ? (
                  <span
                    className="truncate inline-flex items-center gap-0.5"
                    style={{ color: "#60a5fa" }}
                  >
                    <svg
                      width="8"
                      height="8"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="flex-shrink-0"
                      style={{ opacity: 0.5 }}
                    >
                      <path d="M7 7h10v10" />
                      <path d="M7 17 17 7" />
                    </svg>
                    {displayVal}
                  </span>
                ) : (
                  <span
                    className="truncate"
                    style={{ color: "var(--color-text)" }}
                  >
                    {displayVal}
                  </span>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}

function EnumBadgeMini({
  value,
  enumValues,
  enumColors,
}: {
  value: string;
  enumValues?: string[];
  enumColors?: string[];
}) {
  const idx = enumValues?.indexOf(value) ?? -1;
  const color = idx >= 0 && enumColors ? enumColors[idx] : "#94a3b8";

  return (
    <span
      className="inline-flex items-center px-1.5 py-0 rounded text-[11px] font-medium"
      style={{
        background: `${color}20`,
        color: color,
      }}
    >
      {value}
    </span>
  );
}

// --- Kanban Board ---

export function ObjectKanban({
  objectName,
  fields,
  entries,
  statuses,
  members,
  relationLabels,
}: ObjectKanbanProps) {
  // Find the grouping field: prefer a "Status" enum field, fallback to first enum
  const groupField = useMemo(() => {
    const statusField = fields.find(
      (f) =>
        f.type === "enum" &&
        f.name.toLowerCase().includes("status"),
    );
    if (statusField) {return statusField;}
    return fields.find((f) => f.type === "enum") ?? null;
  }, [fields]);

  // Determine columns: from statuses table, or from enum_values, or from unique values
  const columns = useMemo(() => {
    if (statuses.length > 0) {
      return statuses.map((s) => ({
        name: s.name,
        color: s.color ?? "#94a3b8",
      }));
    }
    if (groupField?.enum_values) {
      return groupField.enum_values.map((v, i) => ({
        name: v,
        color: groupField.enum_colors?.[i] ?? "#94a3b8",
      }));
    }
    // Fallback: derive from data
    const unique = new Set<string>();
    for (const e of entries) {
      const val = groupField ? e[groupField.name] : undefined;
      if (val) {unique.add(String(val));}
    }
    return Array.from(unique).map((v) => ({ name: v, color: "#94a3b8" }));
  }, [statuses, groupField, entries]);

  // Group entries by column
  const grouped = useMemo(() => {
    const groups: Record<string, Record<string, unknown>[]> = {};
    for (const col of columns) {groups[col.name] = [];}

    // Ungrouped bucket
    groups["_ungrouped"] = [];

    for (const entry of entries) {
      const val = groupField ? String(entry[groupField.name] ?? "") : "";
      if (groups[val]) {
        groups[val].push(entry);
      } else {
        groups["_ungrouped"].push(entry);
      }
    }
    return groups;
  }, [columns, entries, groupField]);

  // Non-grouping fields for cards
  const cardFields = fields.filter((f) => f !== groupField);

  if (!groupField) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
          No enum field found for kanban grouping in{" "}
          <span className="font-medium" style={{ color: "var(--color-text)" }}>
            {objectName}
          </span>
        </p>
      </div>
    );
  }

  return (
    <div className="flex gap-4 overflow-x-auto pb-4 px-1" style={{ minHeight: "400px" }}>
      {columns.map((col) => {
        const items = grouped[col.name] ?? [];
        return (
          <div
            key={col.name}
            className="flex-shrink-0 flex flex-col rounded-xl"
            style={{
              width: "280px",
              background: "var(--color-bg)",
              border: "1px solid var(--color-border)",
            }}
          >
            {/* Column header */}
            <div className="flex items-center gap-2 px-3 py-2.5 border-b" style={{ borderColor: "var(--color-border)" }}>
              <span
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ background: col.color }}
              />
              <span
                className="text-sm font-medium flex-1"
                style={{ color: "var(--color-text)" }}
              >
                {col.name}
              </span>
              <span
                className="text-xs px-1.5 py-0.5 rounded-full"
                style={{
                  background: "var(--color-surface)",
                  color: "var(--color-text-muted)",
                }}
              >
                {items.length}
              </span>
            </div>

            {/* Cards */}
            <div className="flex-1 overflow-y-auto p-2">
              {items.length === 0 ? (
                <div
                  className="flex items-center justify-center py-8 rounded-lg border border-dashed text-xs"
                  style={{
                    borderColor: "var(--color-border)",
                    color: "var(--color-text-muted)",
                  }}
                >
                  No entries
                </div>
              ) : (
                items.map((entry, idx) => (
                  <KanbanCard
                    key={String(entry.entry_id ?? idx)}
                    entry={entry}
                    fields={cardFields}
                    members={members}
                    relationLabels={relationLabels}
                  />
                ))
              )}
            </div>
          </div>
        );
      })}

      {/* Ungrouped entries */}
      {grouped["_ungrouped"]?.length > 0 && (
        <div
          className="flex-shrink-0 flex flex-col rounded-xl"
          style={{
            width: "280px",
            background: "var(--color-bg)",
            border: "1px dashed var(--color-border)",
          }}
        >
          <div className="flex items-center gap-2 px-3 py-2.5 border-b" style={{ borderColor: "var(--color-border)" }}>
            <span className="text-sm font-medium" style={{ color: "var(--color-text-muted)" }}>
              Ungrouped
            </span>
            <span
              className="text-xs px-1.5 py-0.5 rounded-full"
              style={{
                background: "var(--color-surface)",
                color: "var(--color-text-muted)",
              }}
            >
              {grouped["_ungrouped"].length}
            </span>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {grouped["_ungrouped"].map((entry, idx) => (
              <KanbanCard
                key={String(entry.entry_id ?? idx)}
                entry={entry}
                fields={cardFields}
                members={members}
                relationLabels={relationLabels}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
