import { describe, it, expect } from "vitest";
import { isDue } from "./window";

describe("isDue", () => {
  const prayerMinutes = 17 * 60; // 17:00 = 1020
  const base = { prayerMinutes, offsetMin: 10, graceMin: 5 };

  it("fires from N minutes before up to grace minutes after", () => {
    expect(isDue({ ...base, nowMinutes: 1010 })).toBe(true); // 16:50 (exactly N before)
    expect(isDue({ ...base, nowMinutes: 1015 })).toBe(true); // 16:55
    expect(isDue({ ...base, nowMinutes: 1020 })).toBe(true); // 17:00 (the time)
    expect(isDue({ ...base, nowMinutes: 1025 })).toBe(true); // 17:05 (grace edge)
  });

  it("does not fire before the window opens", () => {
    expect(isDue({ ...base, nowMinutes: 1009 })).toBe(false); // 16:49
  });

  it("does not fire after grace (never pings a passed time late)", () => {
    expect(isDue({ ...base, nowMinutes: 1026 })).toBe(false); // 17:06
  });

  it("supports a zero offset (ping at the time)", () => {
    expect(isDue({ prayerMinutes, offsetMin: 0, graceMin: 5, nowMinutes: 1020 })).toBe(true);
    expect(isDue({ prayerMinutes, offsetMin: 0, graceMin: 5, nowMinutes: 1019 })).toBe(false);
  });
});
