import { cn } from "@/lib/utils";

/**
 * The Sprig lockup: a quiet two-tone leaf-dot beside a confident, tight-tracked
 * sans wordmark, sentence case per the system's chrome rules.
 *
 * The leaf is moss (--primary, the one voice of action) with a 2px clay heart
 * (--glow) at its centre — the two colours the product actually speaks in,
 * stated once at 6px so the mark reads as a seed rather than a badge. The heart
 * is drawn, not animated: nothing in the identity is allowed to pulse.
 *
 * Every public surface (landing, 404, auth, shared canvas) draws its identity
 * from here so the leaf-dot spacing and the tracking stay in one place.
 */
function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "flex items-center gap-2 text-[0.9375rem] font-semibold tracking-[-0.02em] text-foreground",
        className
      )}
    >
      <span
        aria-hidden="true"
        className="flex size-1.5 shrink-0 items-center justify-center rounded-full bg-primary"
      >
        <span className="size-[2px] rounded-full bg-glow" />
      </span>
      <span>Sprig</span>
    </span>
  );
}

export { Wordmark };
