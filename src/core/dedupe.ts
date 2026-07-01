/**
 * Per-day dedupe markers + last-known-good schedule, persisted as JSON files under state/.
 *
 * The dedupe KEY embeds the scheduled time ("asr@17:00") so a genuine last-minute time change
 * (17:00 -> 17:30) mints a NEW key that re-arms exactly one fresh reminder, while the old key
 * stays marked (no re-ping). A same-minute nudge maps to the same key and never double-fires.
 *
 * Markers are committed back to the repo by the workflow so they survive stateless CI runs.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import type { LastKnownGood, PrayerSlot } from "./types";

/** Marker file for a given local date: state/sent-YYYY-MM-DD.json */
export function markerPath(stateDir: string, dateKey: string): string {
  return path.join(stateDir, `sent-${dateKey}.json`);
}

export function lastKnownGoodPath(stateDir: string): string {
  return path.join(stateDir, "last-known-good.json");
}

/** Stable dedupe key: prayer + scheduled time value. Date is implicit in the marker filename. */
export function makeKey(prayerKey: string, time: string): string {
  return `${prayerKey}@${time}`;
}

/** A marker is a map of dedupe-key -> ISO timestamp when it was sent. */
export type Marker = Record<string, string>;

export async function readMarker(stateDir: string, dateKey: string): Promise<Marker> {
  return readJson<Marker>(markerPath(stateDir, dateKey), {});
}

export async function writeMarker(stateDir: string, dateKey: string, marker: Marker): Promise<void> {
  await writeJson(markerPath(stateDir, dateKey), marker);
}

export function hasSent(marker: Marker, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(marker, key);
}

export async function readLastKnownGood(stateDir: string): Promise<LastKnownGood> {
  return readJson<LastKnownGood>(lastKnownGoodPath(stateDir), {});
}

/** Merge the current run's valid prayers into last-known-good (per prayer key) and persist. */
export async function updateLastKnownGood(
  stateDir: string,
  validPrayers: PrayerSlot[],
): Promise<LastKnownGood> {
  const lkg = await readLastKnownGood(stateDir);
  for (const p of validPrayers) {
    lkg[p.key] = { time: p.time, offsetMin: p.offsetMin };
  }
  await writeJson(lastKnownGoodPath(stateDir), lkg);
  return lkg;
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(file: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2) + "\n", "utf8");
}
