import { describe, expect, it } from "vitest";

import { BoundedNdjsonFrameBuffer } from "./ndjson-frame-buffer.ts";

describe("bounded NDJSON frame buffer", () => {
  it("performs amortized-linear work across thousands of fragments", () => {
    const fragmentCount = 4_096;
    const buffer = new BoundedNdjsonFrameBuffer(fragmentCount + 16);
    for (let index = 0; index < fragmentCount; index += 1) {
      buffer.push(new Uint8Array([97]));
      expect(buffer.takeLine()).toBeNull();
    }
    buffer.push(new Uint8Array([10]));

    expect(buffer.takeLine()).toHaveLength(fragmentCount);
    expect(buffer.metrics()).toEqual({
      bytesCopied: fragmentCount,
      bytesPushed: fragmentCount + 1,
      bytesScanned: fragmentCount + 1,
    });
  });

  it("retains trailing bytes and extracts coalesced lines in order", () => {
    const buffer = new BoundedNdjsonFrameBuffer(32);
    buffer.push(new TextEncoder().encode("one\ntwo\ntrail"));

    expect(new TextDecoder().decode(buffer.takeLine() ?? undefined)).toBe(
      "one"
    );
    expect(new TextDecoder().decode(buffer.takeLine() ?? undefined)).toBe(
      "two"
    );
    expect(buffer.takeLine()).toBeNull();
    expect(buffer.pendingByteLength).toBe(5);
  });
});
