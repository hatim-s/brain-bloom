import { describe, expect, it } from "vitest";

import { formatRelativeUpdatedAt } from "./relative-time";

const NOW = Date.UTC(2026, 5, 15, 12, 0, 0);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Verifies the dashboard's date-lib-free "updated" phrasing. */
describe("formatRelativeUpdatedAt", () => {
  it.each([
    ["a write from this second", NOW, "just now"],
    ["59 seconds", NOW - 59_000, "just now"],
    ["exactly one minute", NOW - MINUTE, "1 minute ago"],
    ["59 minutes", NOW - 59 * MINUTE, "59 minutes ago"],
    ["exactly one hour", NOW - HOUR, "1 hour ago"],
    ["23 hours", NOW - 23 * HOUR, "23 hours ago"],
    ["exactly one day", NOW - DAY, "1 day ago"],
    ["6 days", NOW - 6 * DAY, "6 days ago"],
    ["exactly one week", NOW - 7 * DAY, "1 week ago"],
    ["four weeks", NOW - 28 * DAY, "4 weeks ago"],
    ["thirty days", NOW - 30 * DAY, "1 month ago"],
    ["eleven months", NOW - 330 * DAY, "11 months ago"],
    ["the day before one year", NOW - 364 * DAY, "11 months ago"],
    ["one year", NOW - 365 * DAY, "1 year ago"],
    ["three years", NOW - 3 * 365 * DAY, "3 years ago"],
  ])("renders %s", (_label, updatedAt, expected) => {
    expect(formatRelativeUpdatedAt(updatedAt, NOW)).toBe(expected);
  });

  it("collapses future timestamps from a skewed clock to just now", () => {
    expect(formatRelativeUpdatedAt(NOW + 5 * HOUR, NOW)).toBe("just now");
  });
});
