import { cn } from "@/lib/utils";

import { DemoStem } from "./demo-stem";

/** One child row in the demonstrated branch, marked when the model just grew it. */
type BranchChild = {
  label: string;
  isNew?: boolean;
};

const CHILDREN: BranchChild[] = [
  { label: "Photosystem II" },
  { label: "ATP synthase" },
  { label: "Electron transport chain", isNew: true },
  { label: "Water splitting", isNew: true },
  { label: "NADPH", isNew: true },
  { label: "Proton gradient", isNew: true },
];

/**
 * Demonstrates conversational growth: a short real exchange beside the branch
 * it extended.
 *
 * The two halves speak in the product's two vocabularies. On the left, chat
 * bubbles sit as cards on the section's tonal well — the model's reply is the
 * most-raised object in the passage, because it is the thing that acted. On the
 * right, a recessed canvas well holds the branch itself: node cards lifted on
 * the Grove's rest shadow, joined by curved stems rather than right angles. The
 * four just-grown nodes carry clay, the accent that means "the model touched
 * this" and nothing else; everything around them stays quiet.
 */
function ConversationDemo() {
  return (
    <div className="grid items-center gap-10 md:grid-cols-2 md:gap-12">
      {/* The exchange, in the product's own chat vocabulary. */}
      <div className="flex flex-col gap-3">
        <p className="ml-auto max-w-[85%] rounded-lg rounded-br-sm border border-border bg-secondary px-4 py-2.5 text-[0.9375rem] leading-relaxed shadow-rest">
          Go deeper on the light reactions.
        </p>
        <div className="flex max-w-[92%] flex-col gap-2">
          <p className="rounded-lg rounded-bl-sm border border-border bg-popover px-4 py-2.5 text-[0.9375rem] leading-relaxed text-popover-foreground shadow-raised">
            Added four branches under Light reactions — the electron transport
            chain, water splitting, NADPH, and the proton gradient.
          </p>
          <span className="flex items-center gap-2 pl-1 text-[0.8125rem] text-muted-foreground">
            {/* Clay, ringed by its own wash: the model's mark, settled. */}
            <span
              aria-hidden="true"
              className="size-1.5 shrink-0 rounded-full bg-glow ring-2 ring-glow-wash"
            />
            Sprig grew the map — nothing you built was regenerated
          </span>
        </div>
      </div>

      {/* The branch it extended, drawn as a small piece of the canvas itself:
          a recessed well carrying the same dot grid the app draws. */}
      <div className="rounded-lg border border-border bg-background/55 bg-[radial-gradient(var(--canvas-dot)_1px,transparent_1px)] bg-[size:20px_20px] p-4 sm:p-5">
        <span className="inline-flex w-fit items-center rounded-md border border-line-strong bg-card px-4 py-2.5 text-[0.9375rem] font-medium tracking-[-0.01em] shadow-raised">
          Light reactions
        </span>
        {/* `isolate` scopes the stems' negative z-index to this list: each stem
            slides under the card above and the card beside it, so its caps are
            tucked out of sight the way the canvas anchors its edges. */}
        <ul className="isolate ml-4 mt-1 flex flex-col gap-2">
          {CHILDREN.map((child, index) => (
            <li className="flex items-center" key={child.label}>
              {/* A stem, not a wire: it curves out from under the parent and
                  settles into the leaf. The first one only has the parent's
                  edge to reach, so it runs shorter than the rest. The stems
                  feeding the just-grown nodes carry clay with them, the same way
                  the canvas pulses an AI-touched edge. */}
              <DemoStem
                className={cn(
                  "-z-[1] -mr-1 w-3.5 sm:w-4",
                  index === 0
                    ? "h-7 -translate-y-[14px]"
                    : "h-10 -translate-y-[18px]"
                )}
                tone={child.isNew ? "clay" : "neutral"}
              />
              <span
                className={cn(
                  "rounded-sm border px-3 py-1.5 text-sm",
                  child.isNew
                    ? "border-glow bg-glow-wash shadow-rest"
                    : "border-line-strong bg-card shadow-rest"
                )}
              >
                {child.label}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export { ConversationDemo };
