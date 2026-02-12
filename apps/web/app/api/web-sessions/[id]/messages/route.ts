import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export const dynamic = "force-dynamic";

const WEB_CHAT_DIR = join(homedir(), ".openclaw", "web-chat");
const INDEX_FILE = join(WEB_CHAT_DIR, "index.json");

type IndexEntry = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
};

/**
 * POST /api/web-sessions/[id]/messages — append or upsert messages.
 *
 * Uses upsert semantics: if a message with the same `id` already exists
 * in the session JSONL, it is replaced in-place. Otherwise the message
 * is appended. This supports both the client's post-stream save and the
 * server-side incremental persistence from the ActiveRunManager.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const filePath = join(WEB_CHAT_DIR, `${id}.jsonl`);

  // Auto-create the session file if it doesn't exist yet
  if (!existsSync(WEB_CHAT_DIR)) {
    mkdirSync(WEB_CHAT_DIR, { recursive: true });
  }
  if (!existsSync(filePath)) {
    writeFileSync(filePath, "");
  }

  const { messages, title } = await request.json();

  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: "messages array required" }, { status: 400 });
  }

  // Read existing lines for upsert checks.
  const existing = readFileSync(filePath, "utf-8");
  const lines = existing.split("\n").filter((l) => l.trim());
  let newCount = 0;

  for (const msg of messages) {
    const msgId = typeof msg.id === "string" ? msg.id : undefined;
    let found = false;

    if (msgId) {
      for (let i = 0; i < lines.length; i++) {
        try {
          const parsed = JSON.parse(lines[i]);
          if (parsed.id === msgId) {
            // Replace the existing line in-place.
            lines[i] = JSON.stringify(msg);
            found = true;
            break;
          }
        } catch {
          /* keep malformed lines as-is */
        }
      }
    }

    if (!found) {
      lines.push(JSON.stringify(msg));
      newCount++;
    }
  }

  writeFileSync(filePath, lines.join("\n") + "\n");

  // Update index metadata
  try {
    if (existsSync(INDEX_FILE)) {
      const index: IndexEntry[] = JSON.parse(
        readFileSync(INDEX_FILE, "utf-8"),
      );
      const session = index.find((s) => s.id === id);
      if (session) {
        session.updatedAt = Date.now();
        if (newCount > 0) {session.messageCount += newCount;}
        if (title) {session.title = title;}
        writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2));
      }
    }
  } catch {
    // index update is best-effort
  }

  return Response.json({ ok: true });
}
