import { cn } from "@/lib/utils";

/**
 * The Sprig lockup: a leaf-dot in --primary followed by the mono wordmark.
 *
 * Every public surface (landing, 404, shared canvas) draws its identity from
 * here so the leaf-dot spacing and the letter-spacing stay in one place.
 *
 * The trailing negative margin eats the last letter-space that `tracking`
 * appends after the "g", so the lockup optically centres inside its box and
 * sits flush against whatever follows it in a row.
 */
function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "flex items-center gap-2.5 font-mono text-sm uppercase tracking-[0.28em] text-foreground",
        className
      )}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-primary" />
      <span className="-mr-[0.28em]">Sprig</span>
    </span>
  );
}

export { Wordmark };
