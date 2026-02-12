import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { GatewayWebAppConfig } from "../config/types.gateway.js";
import { isTruthyEnvValue } from "../infra/env.js";
import { defaultRuntime, type RuntimeEnv } from "../runtime.js";

export const DEFAULT_WEB_APP_PORT = 3100;

export type WebAppHandle = {
  port: number;
  stop: () => Promise<void>;
};

/**
 * Resolve the `apps/web` directory relative to the package root.
 * Walks up from the current module until we find `apps/web/package.json`.
 */
function resolveWebAppDir(): string | null {
  const __filename = fileURLToPath(import.meta.url);
  let dir = path.dirname(__filename);
  for (let i = 0; i < 10; i++) {
    const candidate = path.join(dir, "apps", "web", "package.json");
    if (fs.existsSync(candidate)) {
      return path.join(dir, "apps", "web");
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return null;
}

/** Check whether a Next.js production build exists. */
function hasNextBuild(webAppDir: string): boolean {
  return fs.existsSync(path.join(webAppDir, ".next", "BUILD_ID"));
}

// ── pre-build ────────────────────────────────────────────────────────────────

export type EnsureWebAppBuiltResult = {
  ok: boolean;
  built: boolean;
  message?: string;
};

/**
 * Pre-build the Next.js web app so the gateway can start it immediately.
 *
 * Call this before installing/starting the gateway daemon so the first
 * gateway boot doesn't block on `next build`.  Skips silently when the
 * web app feature is disabled, already built, or not applicable (e.g.
 * global npm install without `apps/web`).
 */
export async function ensureWebAppBuilt(
  runtime: RuntimeEnv = defaultRuntime,
  opts?: { webAppConfig?: GatewayWebAppConfig },
): Promise<EnsureWebAppBuiltResult> {
  if (isTruthyEnvValue(process.env.OPENCLAW_SKIP_WEB_APP)) {
    return { ok: true, built: false };
  }
  if (opts?.webAppConfig && opts.webAppConfig.enabled === false) {
    return { ok: true, built: false };
  }
  // Dev mode uses `next dev` which compiles on-the-fly — no pre-build needed.
  if (opts?.webAppConfig?.dev) {
    return { ok: true, built: false };
  }

  const webAppDir = resolveWebAppDir();
  if (!webAppDir) {
    // No apps/web directory (e.g. global install) — nothing to build.
    return { ok: true, built: false };
  }

  if (hasNextBuild(webAppDir)) {
    return { ok: true, built: false };
  }

  const log = {
    info: (msg: string) => runtime.log(msg),
    warn: (msg: string) => runtime.error(msg),
  };

  try {
    await ensureDepsInstalled(webAppDir, log);
    runtime.log("Web app not built; building for production (next build)…");
    await runCommand("node", [resolveNextBin(webAppDir), "build"], webAppDir, log);
  } catch (err) {
    return {
      ok: false,
      built: false,
      message: `Web app pre-build failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!hasNextBuild(webAppDir)) {
    return {
      ok: false,
      built: true,
      message: "Web app build completed but .next/BUILD_ID is still missing.",
    };
  }

  return { ok: true, built: true };
}

/**
 * Start the Ironclaw Next.js web app as a child process.
 *
 * - Installs dependencies (`npm install`) if `node_modules/` is missing.
 * - Builds (`next build`) on first start when no `.next/BUILD_ID` exists.
 * - On subsequent gateway starts/restarts, reuses the existing build.
 * - Returns a handle whose `stop()` kills the running server.
 *
 * Child processes (dep install, build, server) inherit the gateway's
 * process group, so they are also terminated when the gateway exits
 * (e.g. Ctrl-C).
 */
export async function startWebAppIfEnabled(
  cfg: GatewayWebAppConfig | undefined,
  log: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void },
): Promise<WebAppHandle | null> {
  if (isTruthyEnvValue(process.env.OPENCLAW_SKIP_WEB_APP)) {
    return null;
  }
  if (!cfg?.enabled) {
    return null;
  }

  const port = cfg.port ?? DEFAULT_WEB_APP_PORT;
  const devMode = cfg.dev === true;

  const webAppDir = resolveWebAppDir();
  if (!webAppDir) {
    log.warn("apps/web directory not found — skipping web app");
    return null;
  }

  let child: ChildProcess;

  if (devMode) {
    // Dev mode: ensure deps, then `next dev`.
    await ensureDepsInstalled(webAppDir, log);
    log.info(`starting web app (dev) on port ${port}…`);
    child = spawn("node", [resolveNextBin(webAppDir), "dev", "--port", String(port)], {
      cwd: webAppDir,
      stdio: "pipe",
      env: { ...process.env, PORT: String(port) },
    });
  } else {
    // Production: install deps if needed, build if needed, then start.
    await ensureDepsInstalled(webAppDir, log);

    if (!hasNextBuild(webAppDir)) {
      log.info("building web app for production (first run)…");
      await runCommand("node", [resolveNextBin(webAppDir), "build"], webAppDir, log);
    } else {
      log.info("existing web app build found — skipping build");
    }

    log.info(`starting web app (production) on port ${port}…`);
    child = spawn("node", [resolveNextBin(webAppDir), "start", "--port", String(port)], {
      cwd: webAppDir,
      stdio: "pipe",
      env: { ...process.env, PORT: String(port) },
    });
  }

  // Forward child stdout/stderr to the gateway log.
  child.stdout?.on("data", (data: Buffer) => {
    for (const line of data.toString().split("\n").filter(Boolean)) {
      log.info(line);
    }
  });
  child.stderr?.on("data", (data: Buffer) => {
    for (const line of data.toString().split("\n").filter(Boolean)) {
      log.warn(line);
    }
  });

  child.on("error", (err) => {
    log.error(`web app process error: ${String(err)}`);
  });

  child.on("exit", (code, signal) => {
    if (code !== null && code !== 0) {
      log.warn(`web app exited with code ${code}`);
    } else if (signal) {
      log.info(`web app terminated by signal ${signal}`);
    }
  });

  log.info(`web app available at http://localhost:${port}`);

  return {
    port,
    stop: async () => {
      if (child.exitCode === null && !child.killed) {
        child.kill("SIGTERM");
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            if (child.exitCode === null && !child.killed) {
              child.kill("SIGKILL");
            }
            resolve();
          }, 5_000);
          child.on("exit", () => {
            clearTimeout(timeout);
            resolve();
          });
        });
      }
    },
  };
}

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Resolve the local `next` CLI entry script from apps/web/node_modules.
 *
 * Using `npx next` is fragile in global installs (pnpm, npm) because npx
 * walks up the node_modules tree and may hit a broken pnpm virtual-store
 * symlink in the parent package. Resolving the local binary directly avoids
 * this issue entirely.
 */
function resolveNextBin(webAppDir: string): string {
  return path.join(webAppDir, "node_modules", "next", "dist", "bin", "next");
}

async function ensureDepsInstalled(
  webAppDir: string,
  log: { info: (msg: string) => void },
): Promise<void> {
  // Use `next` as a sentinel — the mere existence of `node_modules/` is not
  // enough (a pnpm workspace may create the directory without all packages).
  const nextPkg = path.join(webAppDir, "node_modules", "next", "package.json");
  if (fs.existsSync(nextPkg)) {
    return;
  }

  // In a pnpm workspace, run `pnpm install` at the workspace root so hoisted
  // deps resolve correctly. Outside a workspace (npm global install), use npm.
  const rootDir = path.resolve(webAppDir, "..", "..");
  const inWorkspace = fs.existsSync(path.join(rootDir, "pnpm-workspace.yaml"));

  if (inWorkspace) {
    log.info("installing web app dependencies (workspace)…");
    await runCommand("pnpm", ["install"], rootDir, log);
  } else {
    log.info("installing web app dependencies…");
    await runCommand("npm", ["install", "--legacy-peer-deps"], webAppDir, log);
  }
}

function runCommand(
  cmd: string,
  args: string[],
  cwd: string,
  log?: { info: (msg: string) => void },
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd, stdio: "pipe", env: { ...process.env } });
    if (log) {
      proc.stdout?.on("data", (data: Buffer) => {
        for (const line of data.toString().split("\n").filter(Boolean)) {
          log.info(line);
        }
      });
      proc.stderr?.on("data", (data: Buffer) => {
        for (const line of data.toString().split("\n").filter(Boolean)) {
          log.info(line);
        }
      });
    }
    proc.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${cmd} ${args.join(" ")} exited with code ${code}`)),
    );
    proc.on("error", reject);
  });
}
