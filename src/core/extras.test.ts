import { describe, it, expect } from "vitest";
import { pickExtra } from "./extras";
import { EXTRA_HADITH, EXTRA_VERSES } from "./extras-data";
import type { Extra } from "./types";

const verses: Extra[] = [0, 1, 2, 3, 4, 5, 6].map((i) => ({ arabic: `ع${i}`, urdu: `آیت${i}`, ref: `Qur'an 1:${i}` }));
const hadith: Extra[] = [0, 1, 2].map((i) => ({ urdu: `حدیث${i}`, ref: `Sahih al-Bukhari ${i}` }));
const lists = { verses, hadith };

describe("pickExtra", () => {
  it("returns null when off or the date is malformed", () => {
    expect(pickExtra("off", "2026-11-18", 0, lists)).toBeNull();
    expect(pickExtra("verse", "18-11-2026", 0, lists)).toBeNull();
  });

  it("never repeats within a day (up to the list size)", () => {
    const refs = [0, 1, 2, 3, 4].map((slot) => pickExtra("verse", "2026-11-18", slot, lists)!.ref);
    expect(new Set(refs).size).toBe(5);
  });

  it("is deterministic (DRY_RUN shows what the real run posts) and moves on the next day", () => {
    const a = pickExtra("verse", "2026-11-18", 1, lists);
    expect(pickExtra("verse", "2026-11-18", 1, lists)).toEqual(a);
    expect(pickExtra("verse", "2026-11-19", 1, lists)).not.toEqual(a);
  });

  it("'both' alternates verse and hadith across the day", () => {
    const kinds = [0, 1, 2, 3].map((slot) => (pickExtra("both", "2026-11-18", slot, lists)!.arabic ? "v" : "h"));
    expect(kinds).toEqual(kinds[0] === "v" ? ["v", "h", "v", "h"] : ["h", "v", "h", "v"]);
  });

  it("hadith are Urdu only; verses carry Arabic + Urdu", () => {
    expect(pickExtra("hadith", "2026-11-18", 0, lists)!.arabic).toBeUndefined();
    expect(pickExtra("verse", "2026-11-18", 0, lists)!.arabic).toBeTruthy();
  });
});

describe("curated data (extras-data.ts)", () => {
  it("has enough entries, all short (a glance, not a paragraph)", () => {
    expect(EXTRA_VERSES.length).toBeGreaterThanOrEqual(20);
    expect(EXTRA_HADITH.length).toBeGreaterThanOrEqual(10);
    for (const v of EXTRA_VERSES) {
      expect(v.arabic!.length).toBeLessThanOrEqual(110);
      expect(v.urdu.length).toBeLessThanOrEqual(110);
    }
    for (const h of EXTRA_HADITH) expect(h.urdu.length).toBeLessThanOrEqual(120);
  });

  it("verses are Arabic + Urdu, hadith Urdu only, with clean references", () => {
    for (const v of EXTRA_VERSES) {
      expect(v.arabic).toMatch(/[؀-ۿ]/);
      expect(v.urdu).toMatch(/[؀-ۿ]/);
      expect(v.ref).toMatch(/^Qur'an \d+:\d+$/);
    }
    for (const h of EXTRA_HADITH) {
      expect(h.arabic).toBeUndefined();
      expect(h.urdu).toMatch(/[؀-ۿ]/);
      expect(h.ref).toMatch(/^Sahih (al-Bukhari|Muslim) \d+$/);
    }
  });

  it("has no duplicate references", () => {
    const refs = [...EXTRA_VERSES, ...EXTRA_HADITH].map((e) => e.ref);
    expect(new Set(refs).size).toBe(refs.length);
  });
});
