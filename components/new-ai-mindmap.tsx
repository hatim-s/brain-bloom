"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { createMindmapFromAI } from "@/actions/mindmap";
import { useEventCallback } from "@/hooks/use-event-callback";

import { PromptInput } from "./prompt-input";
import { Button } from "./ui/button";

const GENERATION_ERROR_MESSAGES = {
  "not-configured": "AI is not configured",
  "too-many-nodes": "Sprig generated too many nodes — try a narrower prompt.",
  "generation-failed": "Generation failed — try again.",
} as const;

/**
 * One list, two jobs: the cycling placeholder and the one-tap starters. Keeping
 * them identical means the field never suggests something the row below does
 * not offer.
 */
const EXAMPLE_PROMPTS = [
  "How do I start a small business?",
  "Coding projects I could build in a weekend",
  "What goes into a good onboarding flow?",
  "Ways to cut our cloud bill",
];

/**
 * The composer frame: the field, its footer and the one moss action.
 *
 * The page's hero object, so it is a lit clearing rather than a card in a list:
 * the raised card surface at the 22px hero radius, already carrying the Raised
 * shadow at rest and lifting to Floating under the pointer or focus. It stays
 * `relative` so it paints over the canopy-light field behind it.
 */
const COMPOSER_CLASS = [
  "relative rounded-[22px] border border-line-strong bg-card shadow-raised",
  "transition-[border-color,box-shadow] duration-200 ease-settle motion-reduce:transition-none",
  "hover:shadow-floating",
  // The frame carries the focus treatment on behalf of the borderless field
  // inside it: moss border plus the product-wide 2px ring, offset by 2px. The
  // elevation is re-declared after the ring so focus adds light instead of
  // flattening the clearing.
  "has-[textarea:focus-visible]:border-primary",
  "has-[textarea:focus-visible]:shadow-[0_0_0_2px_var(--background),0_0_0_4px_var(--ring),var(--shadow-floating)]",
].join(" ");

/**
 * Prompt form that creates and navigates to one atomic AI mindmap.
 *
 * This is the product's shortest path to value, so the composer is the loudest
 * object on the page — a lit clearing standing in a pool of canopy light — and
 * everything around it stays quiet: examples are borderless chips that only
 * sink on hover, and the working state is a single breathing dot with one line
 * of copy rather than a spinner competing with the button.
 */
function AIMindmapInput() {
  const [userPrompt, setUserPrompt] = useState("");
  const [generationError, setGenerationError] = useState<string | null>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const router = useRouter();

  const [isPending, startTransition] = useTransition();

  const handleSubmit = useEventCallback(async () => {
    // Urgent-priority clear: inside the async transition this update would not
    // commit until the transition settles, leaving a stale error on screen for
    // the whole retry.
    setGenerationError(null);

    startTransition(async () => {
      const aiMindmap = await createMindmapFromAI(userPrompt);

      if (!aiMindmap.ok) {
        setGenerationError(GENERATION_ERROR_MESSAGES[aiMindmap.code]);
        return;
      }

      const publicId = aiMindmap.data.publicId;
      router.push(`/maps/${publicId}`);
      // Refresh the shared server layout so listMine includes the new map.
      router.refresh();
    });
  });

  /** Fills the field from an example and hands focus back so it can be edited. */
  const handleExample = useEventCallback((example: string) => {
    setUserPrompt(example);
    promptRef.current?.focus();
  });

  const canSubmit = !isPending && userPrompt.trim().length > 0;

  return (
    <div className="flex w-full flex-col gap-6">
      <div className={COMPOSER_CLASS}>
        <PromptInput
          disabled={isPending}
          examples={EXAMPLE_PROMPTS}
          onSubmit={handleSubmit}
          onValueChange={setUserPrompt}
          textareaRef={promptRef}
          value={userPrompt}
        />
        <div className="flex items-center justify-between gap-3 px-5 pb-4 pt-1">
          <p className="hidden text-[0.8125rem] text-muted-foreground sm:block">
            <kbd className="font-mono">⌘ ↵</kbd> to grow
          </p>
          <Button
            className="ml-auto"
            disabled={!canSubmit}
            onClick={handleSubmit}
            size="lg"
            type="button"
          >
            {isPending ? "Growing your map" : "Grow the map"}
          </Button>
        </div>
      </div>

      {isPending ? (
        <p
          className="flex items-center gap-2.5 text-[0.8125rem] text-muted-foreground"
          role="status"
        >
          <span aria-hidden="true" className="sprig-glow-dot" />
          Sprig is reading your idea and growing the map — this takes a few
          seconds.
        </p>
      ) : null}

      {generationError ? (
        <p
          className="text-[0.8125rem] font-medium text-destructive"
          role="alert"
        >
          {generationError}
        </p>
      ) : null}

      <div className="flex flex-col gap-2.5">
        <p className="text-[0.8125rem] text-muted-foreground">
          Or start from one of these
        </p>
        <ul className="flex flex-wrap gap-2">
          {EXAMPLE_PROMPTS.map((example) => (
            <li key={example}>
              <button
                // Ghost chips: no fill and no shadow at rest so nothing floats
                // beside the clearing, then a sunken tonal step on hover.
                className="rounded-md border border-transparent bg-transparent px-3 py-1.5 text-left text-[0.8125rem] text-muted-foreground transition-[background-color,border-color,color] duration-200 ease-settle hover:border-border hover:bg-secondary hover:text-foreground disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none"
                disabled={isPending}
                onClick={() => handleExample(example)}
                type="button"
              >
                {example}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export { AIMindmapInput };
