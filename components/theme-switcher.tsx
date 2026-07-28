"use client";

import { Laptop, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { useEventCallback } from "@/hooks/use-event-callback";

const THEME_OPTIONS = ["light", "dark", "system"];

/**
 * The one global theme control: a single button that cycles light → dark →
 * system rather than a menu, because the choice is small enough that opening
 * anything would cost more than trying the next option.
 *
 * It renders nothing until mounted: the resolved theme is client-only, and a
 * server-rendered icon would be a guess the first client paint has to undo.
 */
const ThemeSwitcher = () => {
  const [mounted, setMounted] = useState(false);
  const { theme, setTheme } = useTheme();

  // useEffect only runs on the client, so now we can safely show the UI
  useEffect(() => {
    setMounted(true);
  }, []);

  const handleThemeChange = useEventCallback(() => {
    const currentIndex = THEME_OPTIONS.indexOf(theme ?? "light");
    const nextIndex = (currentIndex + 1) % THEME_OPTIONS.length;
    const nextTheme = THEME_OPTIONS[nextIndex];
    setTheme(nextTheme);
  });

  if (!mounted) {
    return null;
  }

  const ICON_SIZE = 16;

  return (
    <Button
      variant="ghost"
      size="icon"
      className="absolute top-3.5 right-[var(--theme-switcher-inset)] z-10 text-muted-foreground hover:text-foreground"
      aria-label={`Theme: ${theme}. Click to change.`}
      onClick={() => handleThemeChange()}
      title={`Theme: ${theme}. Click to change.`}
      type="button"
    >
      {theme === "light" ? (
        <Sun
          className="transition motion-reduce:transition-none"
          key="light"
          size={ICON_SIZE}
        />
      ) : theme === "dark" ? (
        <Moon
          className="transition motion-reduce:transition-none"
          key="dark"
          size={ICON_SIZE}
        />
      ) : (
        <Laptop
          className="transition motion-reduce:transition-none"
          key="system"
          size={ICON_SIZE}
        />
      )}
    </Button>
  );
};

export { ThemeSwitcher };
