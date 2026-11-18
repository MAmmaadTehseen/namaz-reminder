import { describe, it, expect } from "vitest";
import { resolveForDay } from "./schedule";
import { parseCanvas } from "./canvas";

const OPTS = { fallbackOffset: 10, defaultWeekend: [0, 6] as (0 | 6)[] };
const slot = (line: string) => parseCanvas(line, OPTS).prayers[0]!;

// 2026-11-18 is a Wednesday (3); 2026-11-20 is a Friday (5).
describe("resolveForDay", () => {
  it("uses the base time when no override applies", () => {
    expect(resolveForDay(slot("asr = 17:00 | wed=16:45"), "2026-11-19", 4)).toMatchObject({
      time: "17:00",
      minutes: 17 * 60,
    });
  });

  it("applies a weekday override", () => {
    expect(resolveForDay(slot("asr = 17:00 | wed=16:45"), "2026-11-18", 3)).toMatchObject({
      time: "16:45",
      minutes: 16 * 60 + 45,
    });
  });

  it("a date override beats a weekday override", () => {
    const s = slot("asr = 17:00 | wed=16:45 | 2026-11-18=16:30");
    expect(resolveForDay(s, "2026-11-18", 3)?.time).toBe("16:30");
    expect(resolveForDay(s, "2026-11-25", 3)?.time).toBe("16:45");
  });

  it("skip= beats a weekday override", () => {
    expect(resolveForDay(slot("zuhr = 14:05 | fri=13:30 | skip=Fri"), "2026-11-20", 5)).toBeNull();
  });

  it("a date override un-skips that one day", () => {
    const s = slot("zuhr = 14:05 | skip=Fri | 2026-11-20=13:00");
    expect(resolveForDay(s, "2026-11-20", 5)?.time).toBe("13:00");
    expect(resolveForDay(s, "2026-11-27", 5)).toBeNull();
  });

  it("keeps the offset with an overridden time", () => {
    expect(resolveForDay(slot("asr = 17:00 | off=5 | wed=16:45"), "2026-11-18", 3)?.offsetMin).toBe(5);
  });
});
