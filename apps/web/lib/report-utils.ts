/**
 * Utility functions for report identification and helpers.
 * Extracted for testability.
 */

/** Check if a filename is a report file (.report.json). */
export function isReportFile(filename: string): boolean {
  return filename.endsWith(".report.json");
}

/**
 * Classify a file's type for the tree display.
 * Returns "report", "database", "document", or "file".
 */
export function classifyFileType(
  name: string,
  isDatabaseFile: (n: string) => boolean,
): "report" | "database" | "document" | "file" {
  if (isReportFile(name)) {return "report";}
  if (isDatabaseFile(name)) {return "database";}
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext === "md" || ext === "mdx") {return "document";}
  return "file";
}

/**
 * Generate a slug from a report title for use as a filename.
 */
export function reportTitleToSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/**
 * Determine the CSS grid column span class for a panel size.
 */
export function panelColSpan(size?: string): string {
  switch (size) {
    case "full":
      return "col-span-6";
    case "third":
      return "col-span-2";
    case "half":
    default:
      return "col-span-3";
  }
}

/**
 * Format a numeric value for chart display.
 */
export function formatChartValue(val: unknown): string {
  if (val === null || val === undefined) {return "";}
  if (typeof val === "number") {
    if (Math.abs(val) >= 1_000_000) {return `${(val / 1_000_000).toFixed(1)}M`;}
    if (Math.abs(val) >= 1_000) {return `${(val / 1_000).toFixed(1)}K`;}
    return Number.isInteger(val) ? String(val) : val.toFixed(2);
  }
  return String(val);
}

/**
 * Format a label for chart display (truncates long strings, shortens dates).
 */
export function formatChartLabel(val: unknown): string {
  if (val === null || val === undefined) {return "";}
  const str = String(val);
  if (str.length > 16 && !isNaN(Date.parse(str))) {
    return str.slice(0, 10);
  }
  if (str.length > 20) {return str.slice(0, 18) + "...";}
  return str;
}

/**
 * Validate a report config structure. Returns error message or null if valid.
 */
export function validateReportConfig(config: unknown): string | null {
  if (!config || typeof config !== "object") {return "Config must be an object";}
  const c = config as Record<string, unknown>;
  if (typeof c.title !== "string" || !c.title) {return "Missing title";}
  if (!Array.isArray(c.panels)) {return "panels must be an array";}
  for (let i = 0; i < c.panels.length; i++) {
    const p = c.panels[i] as Record<string, unknown>;
    if (!p.id || typeof p.id !== "string") {return `Panel ${i}: missing id`;}
    if (!p.title || typeof p.title !== "string") {return `Panel ${i}: missing title`;}
    if (!p.type || typeof p.type !== "string") {return `Panel ${i}: missing type`;}
    if (!p.sql || typeof p.sql !== "string") {return `Panel ${i}: missing sql`;}
    if (!p.mapping || typeof p.mapping !== "object") {return `Panel ${i}: missing mapping`;}
  }
  return null;
}
