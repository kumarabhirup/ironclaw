/**
 * POST /api/chat/stop
 *
 * Abort an active agent run. Called by the Stop button.
 * The child process is sent SIGTERM and the run transitions to "error" state.
 */
import { abortRun } from "@/lib/active-runs";

export const runtime = "nodejs";

export async function POST(req: Request) {
	const body: { sessionId?: string } = await req
		.json()
		.catch(() => ({}));

	if (!body.sessionId) {
		return new Response("sessionId required", { status: 400 });
	}

	const aborted = abortRun(body.sessionId);
	return Response.json({ aborted });
}
