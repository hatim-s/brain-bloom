"use client";

import { Laptop, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { useEventCallback } from "@/hooks/use-event-callback";

const THEME_OPTIONS = ["light", "dark", "system"];

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
      className="absolute top-8 right-8 z-10"
      onClick={() => handleThemeChange()}
    >
      {theme === "light" ? (
        <Sun className="transition" key="light" size={ICON_SIZE} />
      ) : theme === "dark" ? (
        <Moon className="transition" key="dark" size={ICON_SIZE} />
      ) : (
        <Laptop className="transition" key="system" size={ICON_SIZE} />
      )}
    </Button>
  );

  // return (
  //   <DropdownMenu>
  //     <DropdownMenuTrigger asChild>
  //       <Button
  //         variant="ghost"
  //         size="icon"
  //         className="absolute top-8 right-8 z-10"
  //       >
  //         {theme === "light" ? (
  //           <Sun key="light" size={ICON_SIZE} />
  //         ) : theme === "dark" ? (
  //           <Moon key="dark" size={ICON_SIZE} />
  //         ) : (
  //           <Laptop key="system" size={ICON_SIZE} />
  //         )}
  //       </Button>
  //     </DropdownMenuTrigger>
  //     <DropdownMenuContent className="w-content" align="end">
  //       <DropdownMenuRadioGroup
  //         value={theme}
  //         onValueChange={(e) => setTheme(e)}
  //       >
  //         <DropdownMenuRadioItem className="flex gap-2" value="light">
  //           <Sun size={ICON_SIZE} className="text-muted-foreground" />
  //           <span>Light</span>
  //         </DropdownMenuRadioItem>
  //         <DropdownMenuRadioItem className="flex gap-2" value="dark">
  //           <Moon size={ICON_SIZE} className="text-muted-foreground" />
  //           <span>Dark</span>
  //         </DropdownMenuRadioItem>
  //         <DropdownMenuRadioItem className="flex gap-2" value="system">
  //           <Laptop size={ICON_SIZE} className="text-muted-foreground" />
  //           <span>System</span>
  //         </DropdownMenuRadioItem>
  //       </DropdownMenuRadioGroup>
  //     </DropdownMenuContent>
  //   </DropdownMenu>
  // );
};

export { ThemeSwitcher };
