"use client";

import { useClerk, useUser } from "@clerk/nextjs";
import clsx from "clsx";
import { useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { api } from "@/convex/_generated/api";
import { useEventCallback } from "@/hooks/use-event-callback";
import { MindmapDB } from "@/types/Mindmap";

import { Button } from "./ui/button";
import { Separator } from "./ui/separator";
import { useSidebar } from "./ui/sidebar";
import { Typography } from "./ui/typography";

/**
 * The shared surface of the two floating chrome clusters.
 *
 * Deliberately the canvas rail's material (see ShareMindmap / SaveMindmap):
 * the card step, a hairline, the Raised shadow and the rail's full rounding, so
 * the map title, the account and the share pill read as one family of islands
 * floating over the grove rather than as a bar plus some pills. The height is
 * the shell's own cluster height, so the two clusters can never drift apart.
 */
const CLUSTER_CLASS = clsx(
  "absolute top-[var(--chrome-cluster-top)] z-20 flex h-[var(--chrome-cluster-height)] items-center",
  "rounded-full border border-border bg-card text-card-foreground shadow-raised",
  "transition-[left,right] duration-300 ease-settle motion-reduce:transition-none"
);

/**
 * The map's name, editable in place for its owner.
 *
 * A quiet control: it reads as plain title text until hovered or focused,
 * then behaves like the input it is. Enter or blur saves through the same
 * rename mutation the model uses (so the change lands in the map's operation
 * history), Escape restores what was there.
 */
function EditableMapTitle({ mindmap }: { mindmap: MindmapDB }) {
  const router = useRouter();
  const rename = useMutation(api.mindmaps.rename);
  const inputRef = useRef<HTMLInputElement>(null);

  // The optimistic display name; the server value catches up via refresh.
  const [name, setName] = useState(mindmap.name);
  const [isSaving, setIsSaving] = useState(false);
  const [hasError, setHasError] = useState(false);

  const commit = useEventCallback(async () => {
    const nextName = name.trim();

    if (nextName.length === 0 || nextName === mindmap.name) {
      setName(mindmap.name);
      return;
    }

    setIsSaving(true);
    setHasError(false);

    try {
      await rename({ mindmapId: mindmap._id, name: nextName });
      setName(nextName);
      // The RSC shell (metadata, sidebar list) still holds the old name.
      router.refresh();
    } catch {
      setName(mindmap.name);
      setHasError(true);
    } finally {
      setIsSaving(false);
    }
  });

  const handleKeyDown = useEventCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        inputRef.current?.blur();
      }

      if (event.key === "Escape") {
        setName(mindmap.name);
        setHasError(false);
        // Blur on the next frame so the restored value is what gets committed.
        requestAnimationFrame(() => inputRef.current?.blur());
      }
    }
  );

  return (
    <div className="flex min-w-0 items-center gap-2">
      <label className="sr-only" htmlFor="sprig-map-title">
        Map name
      </label>
      <input
        className={clsx(
          "h-7 min-w-0 max-w-full truncate rounded-sm border border-transparent bg-transparent px-1.5",
          "field-sizing-content text-sm font-medium text-foreground",
          "transition-colors duration-200 ease-settle motion-reduce:transition-none",
          "hover:border-border focus-visible:border-line-strong"
        )}
        disabled={isSaving}
        id="sprig-map-title"
        maxLength={80}
        onBlur={() => void commit()}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={handleKeyDown}
        ref={inputRef}
        value={name}
      />
      {hasError ? (
        <span
          className="shrink-0 text-xs font-medium text-destructive"
          role="alert"
        >
          Couldn&apos;t rename — try again.
        </span>
      ) : null}
    </div>
  );
}

/**
 * The map's chrome: two compact islands, not a bar.
 *
 * A single full-width sheet across the top read as a boxy application frame and
 * fought the free-flowing canvas underneath it; the shell is full-bleed with
 * things floating over it (DESIGN.md Layout), so the title and the account are
 * two separate clusters with canvas breathing between them. Both sit in the
 * band the floating panels clear (`--panel-top-inset`), centred in it by
 * `--chrome-cluster-top`, and both are opaque so node cards can never drift
 * underneath the type.
 *
 * The title cluster starts one inset past the navigation panel's track and
 * slides in step with it on the panel's own curve. The account cluster stops
 * short of the viewport edge by exactly the ThemeSwitcher's footprint, which
 * floats independently at `--theme-switcher-inset` and would otherwise land on
 * top of Sign out.
 */
function Header({ mindmap }: { mindmap: MindmapDB }) {
  const { signOut } = useClerk();
  const { isLoaded, user } = useUser();
  const { open } = useSidebar();
  // A loaded user can lack both email and full name; fall back to username
  // and finally a static label so the skeleton is strictly a loading state.
  const identity = isLoaded
    ? (user?.primaryEmailAddress?.emailAddress ??
      user?.fullName ??
      user?.username ??
      "Account")
    : null;
  // A letter, not an avatar image: the chrome is a hairline-and-type surface,
  // and a remote photo would be the only bitmap on it. Set in the product
  // sans, not mono, so the chrome speaks one voice.
  const initial = identity?.slice(0, 1).toUpperCase();

  return (
    <>
      <header
        className={clsx(
          CLUSTER_CLASS,
          "min-w-0 px-2",
          // Sizes to its content, but never past the point where it would meet
          // the account cluster on a phone.
          "max-w-[38vw] sm:max-w-[38ch]",
          "left-[var(--panel-inset)]",
          // The desktop panel is the only one that displaces the cluster; below
          // `md` it is an overlay sheet, so the cluster keeps the viewport inset.
          open && "md:left-[var(--sidebar-width)]"
        )}
      >
        {mindmap.isOwner ? (
          <EditableMapTitle mindmap={mindmap} />
        ) : (
          <Typography
            className="min-w-0 truncate px-1.5 text-sm font-medium"
            variant="p"
          >
            {mindmap.name}
          </Typography>
        )}
      </header>

      <div
        className={clsx(
          CLUSTER_CLASS,
          "gap-2 pl-3 pr-1.5",
          "right-[calc(var(--theme-switcher-inset)+2.75rem)]"
        )}
      >
        {isLoaded && identity ? (
          <>
            <span
              aria-hidden="true"
              className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-secondary text-[11px] font-medium text-secondary-foreground"
            >
              {initial}
            </span>
            {/* Off the phone layout, where the canvas is the screen and the
                map's own name outranks the address of the account reading it.
                `sr-only` rather than hidden: it leaves the layout without
                leaving the accessibility tree, so the account is still
                announced next to the initial that stands in for it. */}
            <span
              className="max-w-[22ch] truncate text-sm text-muted-foreground max-sm:sr-only"
              title={identity}
            >
              {identity}
            </span>
          </>
        ) : (
          <span
            aria-label="Loading account"
            className="flex items-center gap-2"
            role="status"
          >
            <span
              aria-hidden="true"
              className="size-7 shrink-0 rounded-full border border-border bg-muted"
            />
            <span
              aria-hidden="true"
              className="h-3.5 w-20 rounded-sm bg-muted max-sm:hidden"
            />
          </span>
        )}
        <Separator
          orientation="vertical"
          className="h-4 shrink-0 bg-border max-sm:hidden"
        />
        <Button
          className="shrink-0 rounded-full text-muted-foreground hover:text-foreground"
          onClick={() => signOut({ redirectUrl: "/sign-in" })}
          size="sm"
          type="button"
          variant="ghost"
        >
          Sign out
        </Button>
      </div>
    </>
  );
}

export { Header };
