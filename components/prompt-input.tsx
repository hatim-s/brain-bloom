"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { Box } from "./ui/box";
import { Textarea } from "./ui/textarea";

/**
 * Prompt field whose empty state cycles through example prompts.
 *
 * The cycling is the point of the component, so under `prefers-reduced-motion`
 * it settles on the first example rather than disappearing.
 */
const PromptInput = ({
  placeholders,
  onChange,
}: {
  placeholders: string[];
  onChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
}) => {
  const [currentPlaceholder, setCurrentPlaceholder] = useState(0);
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    if (prefersReducedMotion) {
      setCurrentPlaceholder(0);
      return;
    }

    const interval = setInterval(() => {
      setCurrentPlaceholder((previous) => (previous + 1) % placeholders.length);
    }, 3000);

    return () => clearInterval(interval);
  }, [placeholders.length, prefersReducedMotion]);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState("");

  return (
    <Box className="relative">
      <Textarea
        className={cn(
          "min-h-32 w-full rounded-lg text-sm sm:text-base",
          "resize-none"
        )}
        onChange={(e) => {
          setValue(e.target.value);
          onChange?.(e);
        }}
        ref={inputRef}
        value={value}
      />
      <div className="absolute flex items-center rounded-full pointer-events-none top-0">
        <AnimatePresence mode="wait">
          {!value && (
            <motion.p
              initial={prefersReducedMotion ? false : { y: 5, opacity: 0 }}
              key={`current-placeholder-${currentPlaceholder}`}
              animate={{ y: 0, opacity: 1 }}
              exit={prefersReducedMotion ? undefined : { y: -15, opacity: 0 }}
              transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
              className="px-3 py-2 text-left text-sm font-normal text-muted-foreground sm:text-base"
            >
              {placeholders[currentPlaceholder]}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </Box>
  );
};

export { PromptInput };
