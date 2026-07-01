import { describe, it, expect } from "vitest";
import { getLocalParts, parseHHMM, to12Hour } from "./time";

describe("getLocalParts (Asia/Karachi, UTC+5, no DST)", () => {
  it("converts a UTC instant to Karachi wall-clock", () => {
    // 2026-07-01 09:00Z -> 14:00 in Karachi (UTC+5), a Wednesday.
    const p = getLocalParts(new Date("2026-07-01T09:00:00Z"));
    expect(p.year).toBe(2026);
    expect(p.month).toBe(7);
    expect(p.day).toBe(1);
    expect(p.hour).toBe(14);
    expect(p.minute).toBe(0);
    expect(p.dateKey).toBe("2026-07-01");
    expect(p.minutesSinceMidnight).toBe(14 * 60);
    expect(p.weekday).toBe(3); // Wednesday
  });

  it("rolls the local date across the UTC midnight boundary", () => {
    // 2026-06-30 19:30Z + 5h -> 2026-07-01 00:30 local.
    const p = getLocalParts(new Date("2026-06-30T19:30:00Z"));
    expect(p.dateKey).toBe("2026-07-01");
    expect(p.hour).toBe(0);
    expect(p.minute).toBe(30);
    expect(p.weekday).toBe(3);
  });

  it("identifies Saturday and Sunday correctly", () => {
    expect(getLocalParts(new Date("2026-07-04T06:00:00Z")).weekday).toBe(6); // Sat
    expect(getLocalParts(new Date("2026-07-05T06:00:00Z")).weekday).toBe(0); // Sun
  });
});

describe("parseHHMM", () => {
  it("parses valid 24h times", () => {
    expect(parseHHMM("00:00")).toBe(0);
    expect(parseHHMM("14:05")).toBe(845);
    expect(parseHHMM("23:59")).toBe(1439);
  });
  it("rejects malformed times", () => {
    for (const bad of ["5:12am", "5.12", "24:00", "14:60", "1405", "", "14:5"]) {
      expect(parseHHMM(bad)).toBeNull();
    }
  });
});

describe("to12Hour", () => {
  it("formats 24h to friendly 12h", () => {
    expect(to12Hour("14:05")).toBe("2:05 PM");
    expect(to12Hour("00:00")).toBe("12:00 AM");
    expect(to12Hour("12:00")).toBe("12:00 PM");
    expect(to12Hour("09:30")).toBe("9:30 AM");
  });
});
