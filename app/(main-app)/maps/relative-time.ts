const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
/** Calendar-free approximations: the dashboard only needs a sense of age. */
const MONTH_MS = 30 * DAY_MS;
const YEAR_MS = 365 * DAY_MS;

/** Builds "1 hour ago" / "4 hours ago" without pulling in a formatting lib. */
function agoPhrase(count: number, unit: string): string {
  return count === 1 ? `1 ${unit} ago` : `${count} ${unit}s ago`;
}

/**
 * Describes how long ago a map was last written, in a single short phrase.
 *
 * Pure by construction: `now` is passed in rather than read from the clock, so
 * the caller decides which render the timestamp is relative to and the function
 * stays trivially testable.
 *
 * Timestamps in the future (a client clock running ahead of Convex) collapse to
 * "just now" rather than rendering a negative duration.
 */
function formatRelativeUpdatedAt(updatedAt: number, now: number): string {
  const elapsed = now - updatedAt;

  if (elapsed < MINUTE_MS) {
    return "just now";
  }
  if (elapsed < HOUR_MS) {
    return agoPhrase(Math.floor(elapsed / MINUTE_MS), "minute");
  }
  if (elapsed < DAY_MS) {
    return agoPhrase(Math.floor(elapsed / HOUR_MS), "hour");
  }
  if (elapsed < WEEK_MS) {
    return agoPhrase(Math.floor(elapsed / DAY_MS), "day");
  }
  if (elapsed < MONTH_MS) {
    return agoPhrase(Math.floor(elapsed / WEEK_MS), "week");
  }
  if (elapsed < YEAR_MS) {
    // Thirty-day buckets can reach 12 before a 365-day year. Keep that
    // unreachable phrase out of the UI and hand over to years at the boundary.
    return agoPhrase(Math.min(11, Math.floor(elapsed / MONTH_MS)), "month");
  }

  return agoPhrase(Math.floor(elapsed / YEAR_MS), "year");
}

export { formatRelativeUpdatedAt };
