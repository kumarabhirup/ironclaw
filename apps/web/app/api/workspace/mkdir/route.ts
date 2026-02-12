import { mkdirSync, existsSync } from "node:fs";
import { safeResolveNewPath } from "@/lib/workspace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/workspace/mkdir
 * Body: { path: string }
 *
 * Creates a new directory in the dench workspace.
 */
export async function POST(req: Request) {
  let body: { path?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { path: relPath } = body;
  if (!relPath || typeof relPath !== "string") {
    return Response.json(
      { error: "Missing 'path' field" },
      { status: 400 },
    );
  }

  const absPath = safeResolveNewPath(relPath);
  if (!absPath) {
    return Response.json(
      { error: "Invalid path or path traversal rejected" },
      { status: 400 },
    );
  }

  if (existsSync(absPath)) {
    return Response.json(
      { error: "Directory already exists" },
      { status: 409 },
    );
  }

  try {
    mkdirSync(absPath, { recursive: true });
    return Response.json({ ok: true, path: relPath });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "mkdir failed" },
      { status: 500 },
    );
  }
}
