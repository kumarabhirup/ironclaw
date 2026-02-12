import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveOpenClawPackageRoot, resolveOpenClawPackageRootSync } from "./openclaw-root.js";

async function makeTempPkg(name: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-root-"));
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ name }));
  return root;
}

describe("resolveOpenClawPackageRoot", () => {
  it("finds package root with name 'openclaw'", async () => {
    const root = await makeTempPkg("openclaw");
    try {
      const distDir = path.join(root, "dist");
      await fs.mkdir(distDir, { recursive: true });
      const moduleUrl = pathToFileURL(path.join(distDir, "entry.js")).toString();
      const result = await resolveOpenClawPackageRoot({ moduleUrl });
      expect(result).toBe(root);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("finds package root with name 'ironclaw'", async () => {
    const root = await makeTempPkg("ironclaw");
    try {
      const distDir = path.join(root, "dist");
      await fs.mkdir(distDir, { recursive: true });
      const moduleUrl = pathToFileURL(path.join(distDir, "entry.js")).toString();
      const result = await resolveOpenClawPackageRoot({ moduleUrl });
      expect(result).toBe(root);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("returns null for unrelated package name", async () => {
    const root = await makeTempPkg("unrelated-package");
    try {
      const moduleUrl = pathToFileURL(path.join(root, "index.js")).toString();
      const result = await resolveOpenClawPackageRoot({ moduleUrl, cwd: root });
      expect(result).toBeNull();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe("resolveOpenClawPackageRootSync", () => {
  it("finds ironclaw package root synchronously", async () => {
    const root = await makeTempPkg("ironclaw");
    try {
      const distDir = path.join(root, "dist");
      await fs.mkdir(distDir, { recursive: true });
      const moduleUrl = pathToFileURL(path.join(distDir, "entry.js")).toString();
      const result = resolveOpenClawPackageRootSync({ moduleUrl });
      expect(result).toBe(root);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("finds openclaw package root synchronously", async () => {
    const root = await makeTempPkg("openclaw");
    try {
      const moduleUrl = pathToFileURL(path.join(root, "dist", "x.js")).toString();
      await fs.mkdir(path.join(root, "dist"), { recursive: true });
      const result = resolveOpenClawPackageRootSync({ moduleUrl });
      expect(result).toBe(root);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
