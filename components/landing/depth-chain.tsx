import { cn } from "@/lib/utils";

import { DemoStem } from "./demo-stem";

/**
 * One path from the photosynthesis map, followed to the depth a single
 * agent pass reaches. Truthful content: each step is a real conceptual
 * narrowing, not filler.
 */
const CHAIN = [
  "Photosynthesis",
  "Calvin cycle",
  "RuBisCO",
  "Why RuBisCO is slow",
  "The photorespiration trade-off",
];

/**
 * How each depth presents itself, index-aligned to CHAIN.
 *
 * Descent is read three ways at once, so the path feels like going down into a
 * topic rather than along a row: the indent steps further right, the sheet
 * settles closer to the ground tone (card → card/60) and lets go of its shadow,
 * and the type quietens through the canvas's own root > branch > leaf scaling.
 * `stem` tunes the curved connector's reach: the first one has a taller root
 * card above it to meet, the rest only need to bridge the row gap.
 */
const DEPTH_STEPS = [
  {
    indent: "",
    stem: "",
    surface: "border-line-strong bg-card shadow-raised",
    type: "text-[1.0625rem] font-[590] tracking-[-0.01em] text-foreground",
  },
  {
    indent: "pl-3 sm:pl-8",
    stem: "h-10 -translate-y-[18px]",
    surface: "border-line-strong bg-card shadow-rest",
    type: "text-[0.9375rem] font-medium text-foreground",
  },
  {
    indent: "pl-6 sm:pl-16",
    stem: "h-9 -translate-y-[16px]",
    surface: "border-line-strong bg-card shadow-rest",
    type: "text-sm text-foreground",
  },
  {
    indent: "pl-9 sm:pl-24",
    stem: "h-9 -translate-y-[16px]",
    surface: "border-border bg-card/75 shadow-rest",
    type: "text-sm text-foreground",
  },
  {
    indent: "pl-12 sm:pl-32",
    stem: "h-9 -translate-y-[16px]",
    surface: "border-border bg-card/60",
    type: "text-sm text-muted-foreground",
  },
];

/**
 * Demonstrates agent depth as a single followed path: five nodes, each a level
 * deeper than the last, joined by the canvas's curved stems and stepping down
 * through the tonal ladder as they go.
 */
function DepthChain() {
  return (
    // `isolate` scopes the stems' negative z-index to this list, so a stem can
    // slide under the cards (its caps tucked out of sight, like the canvas's
    // edge anchors) without dropping behind the section's own background.
    <ol className="isolate flex flex-col gap-2">
      {CHAIN.map((label, index) => {
        const step = DEPTH_STEPS[index];

        return (
          <li className={cn("flex items-center", step.indent)} key={label}>
            {index > 0 && (
              <DemoStem
                className={cn("-z-[1] -mr-1 w-3.5 sm:w-5", step.stem)}
              />
            )}
            <span
              className={cn(
                "rounded-md border px-3.5 py-2",
                step.surface,
                step.type
              )}
            >
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export { DepthChain };
