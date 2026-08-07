import { describe, expect, it, vi } from "vitest";

import {
  createDryRunSummary,
  parseCliOptions,
  parseJsonFixture,
  readJsonFixture,
} from "./cli.ts";
import { validateCandidateConfiguration } from "./validation.ts";

describe("local embedding benchmark CLI", () => {
  it("defaults to dry-run mode with downloads denied", () => {
    expect(parseCliOptions([])).toMatchObject({
      run: false,
      allowDownloads: false,
      outputDirectoryRelative: "latest",
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

  it("rejects absolute and traversal report output paths", () => {
    expect(() => parseCliOptions(["--output-dir", "/tmp/results"])).toThrow(
      /relative path/
    );
    expect(() => parseCliOptions(["--output-dir", "../results"])).toThrow(
      /parent components/
    );
  });

  it("rejects malformed JSON before runtime schema validation", () => {
    expect(() => parseJsonFixture("{not-json", "broken.json")).toThrow(
      /broken.json is not valid JSON/
    );
  });

  it("uses only injected lstat metadata during dry run", async () => {
    const configuration = validateCandidateConfiguration(
      await readJsonFixture("candidates.v1.json")
    );
    const metadataInspector = vi.fn(
      async (_workspace, _root, entry: string) => ({
        path: `/not-opened/${entry}`,
        exists: true,
        kind: "file" as const,
        size: 123,
      })
    );

    const summary = await createDryRunSummary(
      configuration,
      "/unused-workspace",
      metadataInspector
    );

    expect(metadataInspector).toHaveBeenCalledTimes(2);
    expect(summary).toContain("checksum not read");
    expect(summary).toContain("No cache contents");
  });
});
