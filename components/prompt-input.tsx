"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { Box } from "./ui/box";
import { Textarea } from "./ui/textarea";

export function PromptInput({
  placeholders,
  onChange,
}: {
  placeholders: string[];
  onChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
}) {
  const [currentPlaceholder, setCurrentPlaceholder] = useState(0);

  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const startAnimationFn = useCallback(() => {
    intervalRef.current = setInterval(() => {
      setCurrentPlaceholder((prev) => (prev + 1) % placeholders.length);
    }, 3000);
  }, [placeholders]);

  const startAnimation = useRef(startAnimationFn);
  startAnimation.current = startAnimationFn;

  // const handleVisibilityChange = () => {
  //   if (document.visibilityState !== "visible" && intervalRef.current) {
  //     clearInterval(intervalRef.current); // Clear the interval when the tab is not visible
  //     intervalRef.current = null;
  //   } else if (document.visibilityState === "visible") {
  //     startAnimation.current(); // Restart the interval when the tab becomes visible
  //   }
  // };

  useEffect(() => {
    startAnimation.current();
    // document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      // document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState("");

  return (
    <Box className="relative">
      <Textarea
        className={cn(
          "w-full text-sm sm:text-base rounded-xl max-h-10 bg-transparent",
          "dark:text-white text-black focus:outline-none focus:ring-0"
        )}
        onChange={(e) => {
          setValue(e.target.value);
          onChange?.(e);
        }}
        ref={inputRef}
        value={value}
      ></Textarea>
      <div className="absolute flex items-center rounded-full pointer-events-none top-0">
        <AnimatePresence mode="wait">
          {!value && (
            <motion.p
              initial={{
                y: 5,
                opacity: 0,
              }}
              key={`current-placeholder-${currentPlaceholder}`}
              animate={{
                y: 0,
                opacity: 1,
              }}
              exit={{
                y: -15,
                opacity: 0,
              }}
              transition={{
                duration: 0.3,
                ease: "linear",
              }}
              className="dark:text-zinc-500 text-sm sm:text-base font-normal text-neutral-500 px-3 py-2 text-left"
            >
              {placeholders[currentPlaceholder]}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </Box>
  );
}
