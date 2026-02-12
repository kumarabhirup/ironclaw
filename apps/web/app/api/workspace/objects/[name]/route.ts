import { duckdbQuery, duckdbPath, duckdbExec, parseRelationValue } from "@/lib/workspace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ObjectRow = {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  default_view?: string;
  display_field?: string;
  immutable?: boolean;
  created_at?: string;
  updated_at?: string;
};

type FieldRow = {
  id: string;
  name: string;
  type: string;
  description?: string;
  required?: boolean;
  enum_values?: string;
  enum_colors?: string;
  enum_multiple?: boolean;
  related_object_id?: string;
  relationship_type?: string;
  sort_order?: number;
};

type StatusRow = {
  id: string;
  name: string;
  color?: string;
  sort_order?: number;
  is_default?: boolean;
};

type EavRow = {
  entry_id: string;
  created_at: string;
  updated_at: string;
  field_name: string;
  value: string | null;
};

// --- Schema migration (idempotent, runs once per process) ---

let schemaMigrated = false;

function ensureDisplayFieldColumn() {
  if (schemaMigrated) {return;}
  duckdbExec(
    "ALTER TABLE objects ADD COLUMN IF NOT EXISTS display_field VARCHAR",
  );
  schemaMigrated = true;
}

// --- Helpers ---

/**
 * Pivot raw EAV rows into one object per entry with field names as keys.
 */
function pivotEavRows(rows: EavRow[]): Record<string, unknown>[] {
  const grouped = new Map<string, Record<string, unknown>>();

  for (const row of rows) {
    let entry = grouped.get(row.entry_id);
    if (!entry) {
      entry = {
        entry_id: row.entry_id,
        created_at: row.created_at,
        updated_at: row.updated_at,
      };
      grouped.set(row.entry_id, entry);
    }
    if (row.field_name) {
      entry[row.field_name] = row.value;
    }
  }

  return Array.from(grouped.values());
}

function tryParseJson(value: unknown): unknown {
  if (typeof value !== "string") {return value;}
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/** SQL-escape a string (double single-quotes). */
function sqlEscape(s: string): string {
  return s.replace(/'/g, "''");
}

/**
 * Determine the display field for an object.
 * Priority: explicit display_field > heuristic (name/title) > first text field > first field.
 */
function resolveDisplayField(
  obj: ObjectRow,
  objFields: FieldRow[],
): string {
  if (obj.display_field) {return obj.display_field;}

  // Heuristic: look for name/title fields
  const nameField = objFields.find(
    (f) =>
      /\bname\b/i.test(f.name) || /\btitle\b/i.test(f.name),
  );
  if (nameField) {return nameField.name;}

  // Fallback: first text field
  const textField = objFields.find((f) => f.type === "text");
  if (textField) {return textField.name;}

  // Ultimate fallback: first field
  return objFields[0]?.name ?? "id";
}

/**
 * Resolve relation field values to human-readable display labels.
 * Returns: { fieldName: { entryId: displayLabel } }
 */
function resolveRelationLabels(
  fields: FieldRow[],
  entries: Record<string, unknown>[],
): {
  labels: Record<string, Record<string, string>>;
  relatedObjectNames: Record<string, string>;
} {
  const labels: Record<string, Record<string, string>> = {};
  const relatedObjectNames: Record<string, string> = {};

  const relationFields = fields.filter(
    (f) => f.type === "relation" && f.related_object_id,
  );

  for (const rf of relationFields) {
    const relatedObjs = duckdbQuery<ObjectRow>(
      `SELECT * FROM objects WHERE id = '${sqlEscape(rf.related_object_id!)}' LIMIT 1`,
    );
    if (relatedObjs.length === 0) {continue;}
    const relObj = relatedObjs[0];
    relatedObjectNames[rf.name] = relObj.name;

    // Get related object's fields for display field resolution
    const relFields = duckdbQuery<FieldRow>(
      `SELECT * FROM fields WHERE object_id = '${sqlEscape(relObj.id)}' ORDER BY sort_order`,
    );
    const displayFieldName = resolveDisplayField(relObj, relFields);

    // Collect all referenced entry IDs from our entries
    const entryIds = new Set<string>();
    for (const entry of entries) {
      const val = entry[rf.name];
      if (val == null || val === "") {continue;}
      for (const id of parseRelationValue(String(val))) {
        entryIds.add(id);
      }
    }

    if (entryIds.size === 0) {
      labels[rf.name] = {};
      continue;
    }

    // Query display values for the referenced entries
    const idList = Array.from(entryIds)
      .map((id) => `'${sqlEscape(id)}'`)
      .join(",");
    const displayRows = duckdbQuery<{
      entry_id: string;
      value: string;
    }>(
      `SELECT e.id as entry_id, ef.value
       FROM entries e
       JOIN entry_fields ef ON ef.entry_id = e.id
       JOIN fields f ON f.id = ef.field_id
       WHERE e.id IN (${idList})
       AND f.object_id = '${sqlEscape(relObj.id)}'
       AND f.name = '${sqlEscape(displayFieldName)}'`,
    );

    const labelMap: Record<string, string> = {};
    for (const row of displayRows) {
      labelMap[row.entry_id] = row.value || row.entry_id;
    }
    // Fill in any IDs that didn't get a display label
    for (const id of entryIds) {
      if (!labelMap[id]) {labelMap[id] = id;}
    }

    labels[rf.name] = labelMap;
  }

  return { labels, relatedObjectNames };
}

type ReverseRelation = {
  fieldName: string;
  sourceObjectName: string;
  sourceObjectId: string;
  displayField: string;
  entries: Record<string, Array<{ id: string; label: string }>>;
};

/**
 * Find reverse relations: other objects with relation fields pointing TO this object.
 * For each, resolve the display labels and group by target entry ID.
 */
function findReverseRelations(objectId: string): ReverseRelation[] {
  // Find all relation fields in other objects that reference this object
  const reverseFields = duckdbQuery<
    FieldRow & { source_object_id: string; source_object_name: string }
  >(
    `SELECT f.*, f.object_id as source_object_id, o.name as source_object_name
     FROM fields f
     JOIN objects o ON o.id = f.object_id
     WHERE f.type = 'relation'
     AND f.related_object_id = '${sqlEscape(objectId)}'`,
  );

  if (reverseFields.length === 0) {return [];}

  const result: ReverseRelation[] = [];

  for (const rrf of reverseFields) {
    // Get source object and its fields
    const sourceObjs = duckdbQuery<ObjectRow>(
      `SELECT * FROM objects WHERE id = '${sqlEscape(rrf.source_object_id)}' LIMIT 1`,
    );
    if (sourceObjs.length === 0) {continue;}

    const sourceFields = duckdbQuery<FieldRow>(
      `SELECT * FROM fields WHERE object_id = '${sqlEscape(rrf.source_object_id)}' ORDER BY sort_order`,
    );
    const displayFieldName = resolveDisplayField(sourceObjs[0], sourceFields);

    // Fetch all source entries that have this relation field set
    const refRows = duckdbQuery<{
      source_entry_id: string;
      target_value: string;
    }>(
      `SELECT ef.entry_id as source_entry_id, ef.value as target_value
       FROM entry_fields ef
       WHERE ef.field_id = '${sqlEscape(rrf.id)}'
       AND ef.value IS NOT NULL
       AND ef.value != ''`,
    );

    if (refRows.length === 0) {continue;}

    // Get display labels for the source entries
    const sourceEntryIds = [
      ...new Set(refRows.map((r) => r.source_entry_id)),
    ];
    const idList = sourceEntryIds
      .map((id) => `'${sqlEscape(id)}'`)
      .join(",");
    const displayRows = duckdbQuery<{
      entry_id: string;
      value: string;
    }>(
      `SELECT ef.entry_id, ef.value
       FROM entry_fields ef
       JOIN fields f ON f.id = ef.field_id
       WHERE ef.entry_id IN (${idList})
       AND f.name = '${sqlEscape(displayFieldName)}'
       AND f.object_id = '${sqlEscape(rrf.source_object_id)}'`,
    );

    const displayMap: Record<string, string> = {};
    for (const row of displayRows) {
      displayMap[row.entry_id] = row.value || row.entry_id;
    }

    // Build: target_entry_id -> [{id, label}]
    const entriesMap: Record<
      string,
      Array<{ id: string; label: string }>
    > = {};
    for (const row of refRows) {
      const targetIds = parseRelationValue(row.target_value);
      for (const targetId of targetIds) {
        if (!entriesMap[targetId]) {entriesMap[targetId] = [];}
        entriesMap[targetId].push({
          id: row.source_entry_id,
          label: displayMap[row.source_entry_id] || row.source_entry_id,
        });
      }
    }

    result.push({
      fieldName: rrf.name,
      sourceObjectName: rrf.source_object_name,
      sourceObjectId: rrf.source_object_id,
      displayField: displayFieldName,
      entries: entriesMap,
    });
  }

  return result;
}

// --- Route handler ---

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;

  if (!duckdbPath()) {
    return Response.json(
      { error: "DuckDB database not found" },
      { status: 404 },
    );
  }

  // Sanitize name to prevent injection (only allow alphanumeric + underscore)
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    return Response.json(
      { error: "Invalid object name" },
      { status: 400 },
    );
  }

  // Ensure display_field column exists (idempotent migration)
  ensureDisplayFieldColumn();

  // Fetch object metadata
  const objects = duckdbQuery<ObjectRow>(
    `SELECT * FROM objects WHERE name = '${name}' LIMIT 1`,
  );

  if (objects.length === 0) {
    return Response.json(
      { error: `Object '${name}' not found` },
      { status: 404 },
    );
  }

  const obj = objects[0];

  // Fetch fields for this object
  const fields = duckdbQuery<FieldRow>(
    `SELECT * FROM fields WHERE object_id = '${obj.id}' ORDER BY sort_order`,
  );

  // Fetch statuses for this object
  const statuses = duckdbQuery<StatusRow>(
    `SELECT * FROM statuses WHERE object_id = '${obj.id}' ORDER BY sort_order`,
  );

  // Try the PIVOT view first, then fall back to raw EAV query + client-side pivot
  let entries: Record<string, unknown>[] = [];

  const pivotEntries = duckdbQuery(
    `SELECT * FROM v_${name} ORDER BY created_at DESC LIMIT 200`,
  );

  if (pivotEntries.length > 0) {
    entries = pivotEntries;
  } else {
    const rawRows = duckdbQuery<EavRow>(
      `SELECT e.id as entry_id, e.created_at, e.updated_at,
              f.name as field_name, ef.value
       FROM entries e
       JOIN entry_fields ef ON ef.entry_id = e.id
       JOIN fields f ON f.id = ef.field_id
       WHERE e.object_id = '${obj.id}'
       ORDER BY e.created_at DESC
       LIMIT 5000`,
    );

    entries = pivotEavRows(rawRows);
  }

  // Parse enum JSON strings in fields
  const parsedFields = fields.map((f) => ({
    ...f,
    enum_values: f.enum_values ? tryParseJson(f.enum_values) : undefined,
    enum_colors: f.enum_colors ? tryParseJson(f.enum_colors) : undefined,
  }));

  // Resolve relation field values to human-readable display labels
  const { labels: relationLabels, relatedObjectNames } =
    resolveRelationLabels(fields, entries);

  // Enrich fields with related object names for frontend display
  const enrichedFields = parsedFields.map((f) => ({
    ...f,
    related_object_name:
      f.type === "relation" ? relatedObjectNames[f.name] : undefined,
  }));

  // Find reverse relations (other objects linking TO this one)
  const reverseRelations = findReverseRelations(obj.id);

  // Compute the effective display field for this object
  const effectiveDisplayField = resolveDisplayField(obj, fields);

  return Response.json({
    object: obj,
    fields: enrichedFields,
    statuses,
    entries,
    relationLabels,
    reverseRelations,
    effectiveDisplayField,
  });
}
