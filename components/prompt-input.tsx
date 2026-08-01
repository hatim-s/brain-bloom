"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { type KeyboardEvent, type Ref, useEffect, useState } from "react";

import { Textarea } from "./ui/textarea";

/** How long one example prompt holds before the next one takes its place. */
const EXAMPLE_INTERVAL_MS = 3000;

type PromptInputProps = {
  /** Disables writing while a map is being generated. */
  disabled?: boolean;
  /** Prompts cycled through the empty field, one at a time. */
  examples: string[];
  /** Invoked on ⌘/Ctrl + Enter, so the prompt can be sent without reaching. */
  onSubmit?: () => void;
  onValueChange: (value: string) => void;
  /** Lets the composer hand focus back to the field, e.g. after an example. */
  textareaRef?: Ref<HTMLTextAreaElement>;
  value: string;
};

/**
 * The writing surface of the prompt-to-map path.
 *
 * Borderless by design: it sits inside the composer frame, which owns the
 * hairline and the focus ring, so the field reads as paper rather than as a
 * control stacked on a control. The empty state cycles through example
 * prompts as a soft overlay rather than a native placeholder, because a
 * native one cannot animate; under `prefers-reduced-motion` it settles on the
 * first example instead of disappearing.
 */
function PromptInput({
  disabled,
  examples,
  onSubmit,
  onValueChange,
  textareaRef,
  value,
}: PromptInputProps) {
  const [currentExample, setCurrentExample] = useState(0);
  const prefersReducedMotion = useReducedMotion();

  const hasValue = value.length > 0;

  useEffect(() => {
    if (prefersReducedMotion) {
      setCurrentExample(0);
      return;
    }

    // No cycling while the user has text in the field: the overlay is hidden
    // and rotating its key would only churn renders.
    if (hasValue) {
      return;
    }

    const interval = setInterval(() => {
      setCurrentExample((previous) => (previous + 1) % examples.length);
    }, EXAMPLE_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [examples.length, hasValue, prefersReducedMotion]);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      onSubmit?.();
    }
  };

  return (
    <div className="relative">
      <Textarea
        aria-label="What do you want to think through?"
        className="min-h-[8.5rem] resize-none border-0 bg-transparent px-5 py-4 text-base shadow-none focus-visible:ring-0 md:text-base sm:min-h-[9.5rem]"
        disabled={disabled}
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={handleKeyDown}
        ref={textareaRef}
        value={value}
      />
      {/* Overlaid on the field, so it must match the field's own padding and
          type scale exactly or the text appears to jump on the first keypress.
          The whole overlay unmounts on the value prop, not through an exit
          animation: mode="wait" can strand the outgoing example when the
          cycling key changes in the same commit, leaving ghost text under a
          typed prompt. */}
      {!hasValue && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 px-5 py-4"
        >
          <AnimatePresence mode="wait">
            <motion.p
              animate={{ y: 0, opacity: 1 }}
              className="truncate text-base text-muted-foreground"
              exit={prefersReducedMotion ? undefined : { y: -15, opacity: 0 }}
              initial={prefersReducedMotion ? false : { y: 5, opacity: 0 }}
              key={`current-example-${currentExample}`}
              transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
            >
              {examples[currentExample]}
            </motion.p>
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

export { PromptInput };
