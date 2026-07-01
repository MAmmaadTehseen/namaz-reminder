import { describe, it, expect } from "vitest";
import { isWeekend, isHoliday, parseWeekdays, parseHolidays } from "./calendar";

describe("isWeekend", () => {
  it("matches configured weekend days (default Sat+Sun)", () => {
    const weekend = [0, 6] as const;
    expect(isWeekend(6, [...weekend])).toBe(true); // Sat
    expect(isWeekend(0, [...weekend])).toBe(true); // Sun
    expect(isWeekend(5, [...weekend])).toBe(false); // Fri is a working day
    expect(isWeekend(3, [...weekend])).toBe(false); // Wed
  });
});

describe("isHoliday", () => {
  it("matches an exact date key", () => {
    const holidays = ["2026-07-06", "2026-08-14"];
    expect(isHoliday("2026-07-06", holidays)).toBe(true);
    expect(isHoliday("2026-07-01", holidays)).toBe(false);
  });
});

describe("parseWeekdays", () => {
  it("parses names and abbreviations, case-insensitively", () => {
    expect(parseWeekdays("Sat, Sun")).toEqual([6, 0]);
    expect(parseWeekdays("friday saturday")).toEqual([5, 6]);
    expect(parseWeekdays("SUN")).toEqual([0]);
  });
  it("returns null when nothing valid is found", () => {
    expect(parseWeekdays("")).toBeNull();
    expect(parseWeekdays("someday")).toBeNull();
  });
});

describe("parseHolidays", () => {
  it("extracts YYYY-MM-DD dates and ignores trailing labels", () => {
    expect(parseHolidays("2026-07-06, 2026-08-14")).toEqual(["2026-07-06", "2026-08-14"]);
    expect(parseHolidays("2026-07-06 # Eid")).toEqual(["2026-07-06"]);
    expect(parseHolidays("no dates here")).toEqual([]);
  });
});
