// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ThreadSwitcher } from "./ThreadSwitcher";
import type { SprigThreadSummary } from "./useSprigChat";

/** Two persisted threads, already ordered the way the hook hands them over. */
const THREADS: SprigThreadSummary[] = [
  {
    _id: "threads:new" as SprigThreadSummary["_id"],
    _creationTime: 2,
    title: "Reshuffle the launch branch",
  },
  {
    _id: "threads:old" as SprigThreadSummary["_id"],
    _creationTime: 1,
    title: "First pass at the outline",
  },
];

beforeAll(() => {
  // Radix positions the popover with floating-ui, which jsdom cannot observe.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

afterEach(cleanup);

describe("ThreadSwitcher", () => {
  it("lists every conversation and marks the open one", async () => {
    const user = userEvent.setup();

    render(
      <ThreadSwitcher
        activeThreadId="threads:new"
        isStreaming={false}
        onSelect={vi.fn()}
        threads={THREADS}
      />
    );

    await user.click(screen.getByRole("button", { name: "Conversations" }));

    const items = screen.getAllByRole("menuitemradio");

    expect(items.map((item) => item.textContent)).toEqual([
      "Reshuffle the launch branch",
      "First pass at the outline",
    ]);
    expect(items[0].getAttribute("aria-checked")).toBe("true");
    expect(items[1].getAttribute("aria-checked")).toBe("false");
  });

  it("hands the chosen conversation back and closes", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(
      <ThreadSwitcher
        activeThreadId="threads:new"
        isStreaming={false}
        onSelect={onSelect}
        threads={THREADS}
      />
    );

    await user.click(screen.getByRole("button", { name: "Conversations" }));
    await user.click(
      screen.getByRole("menuitemradio", { name: "First pass at the outline" })
    );

    expect(onSelect).toHaveBeenCalledWith(THREADS[1]);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("moves focus between rows with the arrow keys", async () => {
    const user = userEvent.setup();

    render(
      <ThreadSwitcher
        activeThreadId="threads:new"
        isStreaming={false}
        onSelect={vi.fn()}
        threads={THREADS}
      />
    );

    await user.click(screen.getByRole("button", { name: "Conversations" }));

    const items = screen.getAllByRole("menuitemradio");
    await waitFor(() => expect(document.activeElement).toBe(items[0]));
    expect(items.map((item) => item.tabIndex)).toEqual([0, -1]);
    await user.keyboard("{ArrowDown}");

    expect(document.activeElement).toBe(items[1]);
    expect(items.map((item) => item.tabIndex)).toEqual([-1, 0]);

    await user.keyboard("{Home}");

    expect(document.activeElement).toBe(items[0]);
  });

  it("keeps the paused trigger focusable and refuses to open", async () => {
    const user = userEvent.setup();
    render(
      <ThreadSwitcher
        activeThreadId="threads:new"
        isStreaming
        onSelect={vi.fn()}
        threads={THREADS}
      />
    );

    const trigger = screen.getByRole("button", {
      name: "Conversations — paused while Sprig is working",
    });

    expect(trigger).toHaveProperty("disabled", false);
    expect(trigger.getAttribute("aria-disabled")).toBe("true");
    trigger.focus();
    await user.click(trigger);
    expect(document.activeElement).toBe(trigger);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes an open menu and returns focus when streaming starts", async () => {
    const user = userEvent.setup();
    const view = render(
      <ThreadSwitcher
        activeThreadId="threads:old"
        isStreaming={false}
        onSelect={vi.fn()}
        threads={THREADS}
      />
    );

    const trigger = screen.getByRole("button", { name: "Conversations" });
    await user.click(trigger);
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("menuitemradio", {
          name: "First pass at the outline",
        })
      )
    );

    view.rerender(
      <ThreadSwitcher
        activeThreadId="threads:old"
        isStreaming
        onSelect={vi.fn()}
        threads={THREADS}
      />
    );

    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", {
          name: "Conversations — paused while Sprig is working",
        })
      )
    );
  });

  it("invites a first message when nothing has been saved yet", async () => {
    const user = userEvent.setup();

    render(
      <ThreadSwitcher
        activeThreadId={null}
        isStreaming={false}
        onSelect={vi.fn()}
        threads={[]}
      />
    );

    await user.click(screen.getByRole("button", { name: "Conversations" }));

    expect(
      screen.getByText("No conversations yet. Send a message to start one.")
    ).toBeDefined();
  });
});
