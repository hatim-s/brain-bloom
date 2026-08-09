type FrameBufferMetrics = Readonly<{
  bytesCopied: number;
  bytesPushed: number;
  bytesScanned: number;
}>;

type Fragment = {
  bytes: Uint8Array;
  start: number;
};

/**
 * Incrementally finds NDJSON lines without repeatedly joining fragmented input.
 * Each byte is scanned once and copied at most once into its completed line.
 */
class BoundedNdjsonFrameBuffer {
  private fragments: Fragment[] = [];
  private headIndex = 0;
  private scanIndex = 0;
  private scanOffset = 0;
  private currentLineBytes = 0;
  private pendingBytes = 0;
  private bytesCopied = 0;
  private bytesPushed = 0;
  private bytesScanned = 0;

  constructor(private readonly maxLineBytes: number) {
    if (!Number.isSafeInteger(maxLineBytes) || maxLineBytes < 1) {
      throw new RangeError("Invalid NDJSON line bound");
    }
  }

  /** Retains one immutable transport fragment without copying its bytes. */
  push(bytes: Uint8Array): void {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
      throw new TypeError("Invalid NDJSON fragment");
    }
    this.fragments.push({ bytes, start: 0 });
    this.pendingBytes += bytes.byteLength;
    this.bytesPushed += bytes.byteLength;
  }

  /** Returns the next complete line, excluding its newline, or null. */
  takeLine(): Uint8Array | null {
    while (this.scanIndex < this.fragments.length) {
      const fragment = this.fragments[this.scanIndex];
      const newline = fragment.bytes.indexOf(10, this.scanOffset);
      if (newline < 0) {
        const scanned = fragment.bytes.byteLength - this.scanOffset;
        this.bytesScanned += scanned;
        this.currentLineBytes += scanned;
        if (this.currentLineBytes > this.maxLineBytes) {
          throw new RangeError("NDJSON line exceeds bound");
        }
        this.scanIndex += 1;
        this.scanOffset =
          this.scanIndex < this.fragments.length
            ? this.fragments[this.scanIndex].start
            : 0;
        continue;
      }

      const finalSegmentBytes = newline - this.scanOffset;
      const lineBytes = this.currentLineBytes + finalSegmentBytes;
      this.bytesScanned += finalSegmentBytes + 1;
      if (lineBytes > this.maxLineBytes) {
        throw new RangeError("NDJSON line exceeds bound");
      }

      const line = new Uint8Array(lineBytes);
      let destinationOffset = 0;
      for (let index = this.headIndex; index <= this.scanIndex; index += 1) {
        const current = this.fragments[index];
        const end =
          index === this.scanIndex ? newline : current.bytes.byteLength;
        const slice = current.bytes.subarray(current.start, end);
        line.set(slice, destinationOffset);
        destinationOffset += slice.byteLength;
      }
      this.bytesCopied += lineBytes;
      this.pendingBytes -= lineBytes + 1;

      fragment.start = newline + 1;
      this.headIndex = this.scanIndex;
      if (fragment.start === fragment.bytes.byteLength) this.headIndex += 1;
      this.currentLineBytes = 0;
      this.compactConsumedFragments();
      this.scanIndex = this.headIndex;
      this.scanOffset =
        this.scanIndex < this.fragments.length
          ? this.fragments[this.scanIndex].start
          : 0;
      return line;
    }
    return null;
  }

  /** Reports unframed bytes so EOF can reject truncated/trailing content. */
  get pendingByteLength(): number {
    return this.pendingBytes;
  }

  /** Exposes deterministic work counters for adversarial complexity tests. */
  metrics(): FrameBufferMetrics {
    return Object.freeze({
      bytesCopied: this.bytesCopied,
      bytesPushed: this.bytesPushed,
      bytesScanned: this.bytesScanned,
    });
  }

  /** Periodically drops consumed descriptors without shifting per fragment. */
  private compactConsumedFragments(): void {
    if (this.headIndex < 64) return;
    this.fragments = this.fragments.slice(this.headIndex);
    this.scanIndex -= this.headIndex;
    this.headIndex = 0;
  }
}

export { BoundedNdjsonFrameBuffer, type FrameBufferMetrics };
