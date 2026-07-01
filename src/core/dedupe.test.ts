import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  makeKey,
  readMarker,
  writeMarker,
  hasSent,
  readLastKnownGood,
  updateLastKnownGood,
} from "./dedupe";
import type { PrayerSlot } from "./types";

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "namaz-dedupe-"));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("makeKey", () => {
  it("embeds the scheduled time so a changed time re-arms", () => {
    expect(makeKey("asr", "17:00")).toBe("asr@17:00");
    expect(makeKey("asr", "17:30")).not.toBe(makeKey("asr", "17:00"));
  });
});

describe("marker round-trip", () => {
  it("returns an empty marker when the file is absent", async () => {
    expect(await readMarker(dir, "2026-07-01")).toEqual({});
  });

  it("persists and reads back sent keys", async () => {
    const marker = { "asr@17:00": new Date("2026-07-01T12:00:00Z").toISOString() };
    await writeMarker(dir, "2026-07-01", marker);
    const read = await readMarker(dir, "2026-07-01");
    expect(hasSent(read, "asr@17:00")).toBe(true);
    expect(hasSent(read, "zuhr@14:05")).toBe(false);
  });
});

describe("last-known-good", () => {
  it("merges valid prayers per key across runs", async () => {
    const p = (key: string, time: string): PrayerSlot => ({
      key,
      time,
      minutes: 0,
      offsetMin: 10,
      enabled: true,
    });
    await updateLastKnownGood(dir, [p("zuhr", "14:05"), p("asr", "17:00")]);
    await updateLastKnownGood(dir, [p("asr", "17:30")]); // asr changes; zuhr retained
    const lkg = await readLastKnownGood(dir);
    expect(lkg.zuhr).toEqual({ time: "14:05", offsetMin: 10 });
    expect(lkg.asr).toEqual({ time: "17:30", offsetMin: 10 });
  });
});
