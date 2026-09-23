import { describe, it, expect } from "vitest";
import { workingHoursBetween, ageingBand, DEFAULT_CALENDAR } from "@/core/calendar/workingHours";

// IST = UTC+5:30. Helpers build instants from IST wall-clock times.
const ist = (y: number, m: number, d: number, hh: number, mm = 0) => new Date(Date.UTC(y, m - 1, d, hh - 5, mm - 30));

describe("working-hours ageing (UAT-07)", () => {
  it("Friday 18:30 → Monday 10:30 = 1 working hour", () => {
    // 2026-09-25 is a Friday
    const h = workingHoursBetween(ist(2026, 9, 25, 18, 30), ist(2026, 9, 28, 10, 30), DEFAULT_CALENDAR);
    expect(h).toBeCloseTo(1, 5);
  });
  it("same working day", () => {
    expect(workingHoursBetween(ist(2026, 9, 23, 11, 0), ist(2026, 9, 23, 15, 30), DEFAULT_CALENDAR)).toBeCloseTo(4.5, 5);
  });
  it("outside working hours counts nothing", () => {
    expect(workingHoursBetween(ist(2026, 9, 23, 20, 0), ist(2026, 9, 23, 23, 0), DEFAULT_CALENDAR)).toBe(0);
  });
  it("holidays are skipped", () => {
    const cal = { ...DEFAULT_CALENDAR, holidays: ["2026-09-24"] };
    expect(workingHoursBetween(ist(2026, 9, 23, 18, 0), ist(2026, 9, 25, 11, 0), cal)).toBeCloseTo(2, 5);
  });
  it("bands", () => {
    expect(ageingBand(4, [1, 3, 7])).toBe("0-1");
    expect(ageingBand(9, [1, 3, 7])).toBe("1-3");
    expect(ageingBand(30, [1, 3, 7])).toBe("3-7");
    expect(ageingBand(100, [1, 3, 7])).toBe("7+");
  });
});
