import { describe, expect, it } from "vitest";

import { assertExecutionPolicy, validateCliDownloadFlags } from "./policy.ts";

describe("embedding benchmark execution policy", () => {
  it("denies execution without an explicit run flag", () => {
    expect(() =>
      assertExecutionPolicy({
        run: false,
        allowDownloads: false,
        cacheExists: true,
      })
    ).toThrow(/--run/);
  });

  it("denies downloads on a cache miss unless explicitly allowed", () => {
    expect(() =>
      assertExecutionPolicy({
        run: true,
        allowDownloads: false,
        cacheExists: false,
      })
    ).toThrow(/downloads remain denied/);
    expect(() =>
      assertExecutionPolicy({
        run: true,
        allowDownloads: true,
        cacheExists: false,
      })
    ).not.toThrow();
  });

  it("does not allow the download flag to be inert in dry-run mode", () => {
    expect(() => validateCliDownloadFlags(false, true)).toThrow(
      /only together with --run/
    );
  });
});
