import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * src/core must stay framework-agnostic so the plain `tsx` CI script can import it.
 * Importing next/*, react, or "server-only" would break the script (server-only throws
 * outside a Next build). This test is the guard that replaces an ESLint rule.
 */
const CORE_DIR = path.dirname(fileURLToPath(import.meta.url));
const FORBIDDEN = /from\s+["'](next(\/.*)?|react(-dom)?(\/.*)?|server-only)["']/;

describe("src/core is framework-agnostic", () => {
  it("no core module imports next/react/server-only", async () => {
    const files = (await fs.readdir(CORE_DIR)).filter(
      (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
    );
    const offenders: string[] = [];
    for (const file of files) {
      const src = await fs.readFile(path.join(CORE_DIR, file), "utf8");
      if (FORBIDDEN.test(src)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
