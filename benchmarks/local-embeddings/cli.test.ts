import { describe, expect, it } from "vitest";

import { parseCliOptions, preflightExecutionCaches } from "./cli.ts";
import type { CandidateConfiguration } from "./types.ts";

describe("local embedding benchmark CLI", () => {
  it("defaults to dry-run mode with downloads denied", () => {
    expect(parseCliOptions([])).toMatchObject({
      run: false,
      allowDownloads: false,
    });
  });

  it("requires an injected adapter for execution", () => {
    expect(() => parseCliOptions(["--run"])).toThrow(/adapter-module/);
  });

  it("accepts explicit run and download consent together", () => {
    expect(
      parseCliOptions([
        "--run",
        "--allow-downloads",
        "--adapter-module",
        "./adapter.mjs",
      ])
    ).toMatchObject({
      run: true,
      allowDownloads: true,
      adapterModule: "./adapter.mjs",
    });
  });

  it("denies missing caches before an adapter module can be imported", async () => {
    const configuration: CandidateConfiguration = {
      schemaVersion: 1,
      budgets: {
        maxColdLoadMs: 1,
        maxWarmQueryP95Ms: 1,
        minIngestionSegmentsPerSecond: 1,
        maxResidentMemoryMb: 1,
        maxCacheBytes: 1,
      },
      candidates: ["a", "b"].map((key) => ({
        key,
        modelId: `local/${key}`,
        revision: key.repeat(40),
        dimensions: 3,
        artifactChecksum: `sha256:${key.repeat(64)}`,
        offlineCachePath: `definitely-missing-${key}`,
      })),
    };

    await expect(
      preflightExecutionCaches(configuration, "/tmp", false)
    ).rejects.toThrow(/downloads remain denied/);
  });
});
