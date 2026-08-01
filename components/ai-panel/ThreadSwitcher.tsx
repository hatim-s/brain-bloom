"use client";

import { Check, MessagesSquare } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import type { SprigThreadSummary } from "./useSprigChat";

/** Keys the menu handles itself so arrow navigation matches a real menu. */
const ROVING_KEYS = new Set(["ArrowDown", "ArrowUp", "Home", "End"]);

type ThreadSwitcherProps = {
  activeThreadId: string | null;
  /** Switching mid-stream is refused by the hook, so the trigger says so. */
  isStreaming: boolean;
  onSelect: (thread: SprigThreadSummary) => void;
  threads: SprigThreadSummary[] | undefined;
};

/**
 * The past conversations on this map, one click from the panel header.
 *
 * A menu rather than a listbox: choosing a row is an action that replaces what
 * the panel is showing, not a form value being edited. The rows are
 * `menuitemradio` so the reader hears which conversation is already open, and
 * the list owns arrow/Home/End roving because a `role="menu"` promises it.
 *
 * Choosing a conversation is the writer's action, so the open row's check is
 * moss (`text-primary`) — selection, per the one-voice rule. No clay anywhere in
 * this menu: past conversations are history, not the model working.
 */
function ThreadSwitcher({
  activeThreadId,
  isStreaming,
  onSelect,
  threads,
}: ThreadSwitcherProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [rovingThreadId, setRovingThreadId] = useState<string | null>(
    activeThreadId
  );
  const listRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const previousIsOpenRef = useRef(isOpen);
  const threadsRef = useRef(threads);
  const activeThreadIdRef = useRef(activeThreadId);

  // Keep the initial-focus effect tied only to opening, not to live-query
  // list updates that can arrive while someone is moving through the menu.
  threadsRef.current = threads;
  activeThreadIdRef.current = activeThreadId;

  const triggerLabel = isStreaming
    ? "Conversations — paused while Sprig is working"
    : "Conversations";

  useEffect(() => {
    if (!isStreaming || !isOpen) {
      return;
    }

    setIsOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, [isOpen, isStreaming]);

  useEffect(() => {
    const wasOpen = previousIsOpenRef.current;
    previousIsOpenRef.current = isOpen;

    if (!isOpen || wasOpen) {
      return;
    }

    const currentThreads = threadsRef.current;
    if (currentThreads === undefined || currentThreads.length === 0) {
      return;
    }

    const initialThread =
      currentThreads.find(
        (thread) => thread._id === activeThreadIdRef.current
      ) ?? currentThreads[0];
    setRovingThreadId(initialThread._id);
    listRef.current
      ?.querySelector<HTMLButtonElement>(
        `[data-thread-id="${initialThread._id}"]`
      )
      ?.focus();
  }, [isOpen]);

  /** Moves focus between rows without letting the popover scroll under it. */
  function handleListKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!ROVING_KEYS.has(event.key)) {
      return;
    }

    const items = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitemradio"]'
      ) ?? []
    );

    if (items.length === 0) {
      return;
    }

    event.preventDefault();

    const currentIndex = items.indexOf(
      document.activeElement as HTMLButtonElement
    );
    const lastIndex = items.length - 1;
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? lastIndex
          : event.key === "ArrowDown"
            ? (currentIndex + 1) % items.length
            : (currentIndex - 1 + items.length) % items.length;

    setRovingThreadId(items[nextIndex]?.dataset.threadId ?? null);
    items[nextIndex]?.focus();
  }

  /** Closes first so focus returns to the trigger, then hands off the choice. */
  function handleSelect(thread: SprigThreadSummary) {
    if (isStreaming) {
      return;
    }

    setIsOpen(false);
    onSelect(thread);
  }

  /** Keeps the controlled popover closed while the active turn owns the panel. */
  function handleOpenChange(nextIsOpen: boolean): void {
    if (nextIsOpen && isStreaming) {
      return;
    }

    setIsOpen(nextIsOpen);
  }

  return (
    <Popover onOpenChange={handleOpenChange} open={isOpen}>
      <PopoverTrigger asChild>
        <Button
          aria-disabled={isStreaming}
          aria-label={triggerLabel}
          className={cn(
            "size-7 rounded-md text-muted-foreground hover:text-foreground",
            isStreaming && "cursor-not-allowed opacity-60"
          )}
          onClick={(event) => {
            if (isStreaming) {
              event.preventDefault();
            }
          }}
          ref={triggerRef}
          size="icon"
          title={triggerLabel}
          type="button"
          variant="ghost"
        >
          <MessagesSquare aria-hidden="true" className="!size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0" sideOffset={8}>
        <p className="border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">
          Conversations
        </p>
        {threads === undefined ? (
          <p className="px-3 py-3 text-sm text-muted-foreground" role="status">
            Loading conversations…
          </p>
        ) : threads.length === 0 ? (
          <p className="px-3 py-3 text-sm text-muted-foreground">
            No conversations yet. Send a message to start one.
          </p>
        ) : (
          <div
            aria-label="Conversations"
            className="scrollbar-styles max-h-64 overflow-y-auto p-1"
            onKeyDown={handleListKeyDown}
            ref={listRef}
            role="menu"
            tabIndex={-1}
          >
            {threads.map((thread) => {
              const isActive = thread._id === activeThreadId;

              return (
                <button
                  aria-checked={isActive}
                  className={cn(
                    "flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left text-sm",
                    "transition-colors duration-200 ease-settle motion-reduce:transition-none",
                    "hover:bg-accent hover:text-accent-foreground",
                    isActive ? "text-foreground" : "text-muted-foreground"
                  )}
                  data-thread-id={thread._id}
                  key={thread._id}
                  onClick={() => handleSelect(thread)}
                  role="menuitemradio"
                  tabIndex={thread._id === rovingThreadId ? 0 : -1}
                  title={thread.title}
                  type="button"
                >
                  <Check
                    aria-hidden="true"
                    className={cn(
                      "mt-0.5 size-3.5 shrink-0",
                      isActive ? "text-primary" : "opacity-0"
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {thread.title}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

export { ThreadSwitcher };
