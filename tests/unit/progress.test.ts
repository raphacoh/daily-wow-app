import { describe, expect, it } from "vitest";
import { badgesFor, computeStreak, levelFor, localDate, nextLocalMidnight, xpFor } from "@/lib/progress";

describe("xpFor", () => {
  it("applies score × 10 + 20 + min(50, streak × 5)", () => {
    expect(xpFor(11, true, 1, false)).toBe(135);
    expect(xpFor(11, true, 12, false)).toBe(180);
    expect(xpFor(7, false, 3, false)).toBe(70);
  });
  it("gives no streak bonus on a late completion", () => {
    expect(xpFor(11, true, 4, true)).toBe(130);
  });
});

describe("computeStreak", () => {
  const released = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"];
  it("counts consecutive on-time completions ending at the newest edition", () => {
    expect(computeStreak(released, ["2026-09-03", "2026-09-04", "2026-09-05"], "2026-09-05")).toBe(3);
  });
  it("keeps the streak alive while today's edition is still open", () => {
    expect(computeStreak(released, ["2026-09-03", "2026-09-04"], "2026-09-05")).toBe(2);
  });
  it("breaks on a missed edition", () => {
    expect(computeStreak(released, ["2026-09-02", "2026-09-03", "2026-09-05"], "2026-09-05")).toBe(1);
    expect(computeStreak(released, ["2026-09-02", "2026-09-03"], "2026-09-05")).toBe(0);
  });
  it("ignores days without a released edition (a HOLD)", () => {
    expect(computeStreak(["2026-09-01", "2026-09-02", "2026-09-04"], ["2026-09-01", "2026-09-02", "2026-09-04"], "2026-09-04")).toBe(3);
  });
  it("ignores future editions", () => {
    expect(computeStreak([...released, "2026-09-06"], ["2026-09-04", "2026-09-05"], "2026-09-05")).toBe(2);
  });
});

describe("badgesFor", () => {
  it("awards first day, no mistakes, challenge and milestones", () => {
    expect(badgesFor({ complete: true, late: false, score: 11, max: 11, challenge: true, streakAfter: 3, firstEverCompletion: true })).toEqual([
      "היום הראשון",
      "בלי טעויות",
      "האתגר",
      "רצף 3",
    ]);
  });
  it("gives no streak badges when late", () => {
    expect(badgesFor({ complete: true, late: true, score: 5, max: 11, challenge: false, streakAfter: 7, firstEverCompletion: true })).toEqual([]);
  });
});

describe("levels & dates", () => {
  it("names levels with gender", () => {
    expect(levelFor(0, false).name).toBe("סקרן");
    expect(levelFor(160, true).name).toBe("חוקרת צעירה");
    expect(levelFor(4000, false).next).toBeNull();
  });
  it("computes local dates and midnight in Asia/Jerusalem", () => {
    const at = new Date("2026-09-07T22:30:00Z"); // 01:30 on the 8th in Jerusalem (UTC+3)
    expect(localDate(at, "Asia/Jerusalem")).toBe("2026-09-08");
    const mid = nextLocalMidnight(at, "Asia/Jerusalem");
    expect(mid.toISOString()).toBe("2026-09-08T21:00:00.000Z");
  });
});
