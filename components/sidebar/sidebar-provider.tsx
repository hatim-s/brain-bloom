"use client";

import { PropsWithChildren, useEffect, useState } from "react";

import { useEventCallback } from "@/hooks/use-event-callback";

import { SidebarProvider as BaseSidebarProvider } from "../ui/sidebar";

export function SidebarProvider(props: PropsWithChildren) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const storedState = localStorage.getItem("sidebar-state");
    if (storedState) {
      setOpen(storedState === "open");
    }
  }, []);

  const handleToggle = useEventCallback((_open: boolean) => {
    setOpen(_open);
    localStorage.setItem("sidebar-state", _open ? "open" : "closed");
    return _open;
  });

  return (
    <BaseSidebarProvider open={open} onOpenChange={handleToggle}>
      {props.children}
    </BaseSidebarProvider>
  );
}
