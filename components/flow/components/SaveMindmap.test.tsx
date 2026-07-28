// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Edge } from "@xyflow/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { MindmapDB } from "@/types/Mindmap";

import { ROOT_NODE_ID } from "../const";
import { createEdge } from "../mindmap/createEdge";
import { createBaseFlowNodeFromPartialBaseFlowNode } from "../mindmap/createNode";
import {
  MindmapFlowProvider,
  useMindmapStoreApi,
} from "../providers/MindmapFlowProvider";
import { BaseFlowNode, NodeTypes } from "../types";
import { SaveMindmap } from "./SaveMindmap";

let store: ReturnType<typeof useMindmapStoreApi>;

beforeAll(() => {
  // Radix positions the tooltip with floating-ui, which jsdom cannot observe.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(cleanup);

describe("SaveMindmap", () => {
  it("rests on 'Saved' with a still dot", () => {
    renderStatusPill();

    const status = screen.getByRole("status");
    const pill = status.firstElementChild;

    expect(status.textContent).toBe("Saved");
    expect(status.dataset.syncState).toBe("idle");
    expect(pill?.className).toContain("pointer-events-none");
  });

  it("reports queued and in-flight writes with one 'Saving…' label", () => {
    renderStatusPill();

    act(() => store.getState().actions.markSyncState("dirty"));

    expect(screen.getByRole("status").textContent).toBe("Saving…");
    expect(screen.getByRole("status").dataset.syncState).toBe("dirty");

    act(() => store.getState().actions.markSyncState("saving"));

    // The label is stable across the queued-to-in-flight handoff, so the live
    // region does not re-announce a state the writer cannot act on.
    expect(screen.getByRole("status").textContent).toBe("Saving…");
    expect(screen.getByRole("status").dataset.syncState).toBe("saving");
  });

  it("announces a transient failure with an immediate retry button", async () => {
    const user = userEvent.setup();
    renderStatusPill();

    act(() => store.getState().actions.markSyncState("error", "Network down"));

    const status = screen.getByRole("status");
    const retryButton = screen.getByRole("button", {
      name: "Not saved — retrying. Click to retry now.",
    });

    expect(status.dataset.syncState).toBe("error");
    expect(status.textContent).toBe(
      "Not saved — retrying. Click to retry now."
    );
    expect(retryButton.className).not.toContain("pointer-events-none");

    await user.click(retryButton);
    expect(store.getState().syncRetryNonce).toBe(1);
  });

  it("reveals the failure detail in a tooltip on keyboard focus", async () => {
    const user = userEvent.setup();
    renderStatusPill();

    act(() => store.getState().actions.markSyncState("error", "Network down"));
    await user.tab();

    const tooltip = await screen.findByRole("tooltip");

    expect(tooltip.textContent).toContain("Network down");
  });

  it("warns that rejected edits live only in the current screen", () => {
    renderStatusPill();

    act(() =>
      store
        .getState()
        .actions.markSyncRejected("Invalid op: parent is on another side")
    );

    expect(screen.getByRole("status").textContent).toBe(
      "Some changes couldn't be saved and live only on this screen. Reload to resync."
    );
    expect(
      screen.getByRole("button", {
        name: "Some changes couldn't be saved and live only on this screen. Reload to resync.",
      })
    ).toBeDefined();
  });

  it("returns to 'Saved' once the retry succeeds", () => {
    renderStatusPill();

    act(() => store.getState().actions.markSyncState("error", "Network down"));
    act(() => store.getState().actions.markSyncState("idle"));

    const status = screen.getByRole("status");

    expect(status.textContent).toBe("Saved");
    expect(status.dataset.syncState).toBe("idle");
  });
});

/** Mounts the pill over a real store so state moves through the provider. */
function renderStatusPill(): void {
  render(
    <TooltipProvider delayDuration={0}>
      <MindmapFlowProvider {...createPillFixture()}>
        <StoreProbe />
        <SaveMindmap />
      </MindmapFlowProvider>
    </TooltipProvider>
  );
}

/** Captures the store so tests can drive sync state the way the sync hook does. */
function StoreProbe() {
  store = useMindmapStoreApi();
  return null;
}

/** Creates the smallest rooted graph the provider will accept. */
function createPillFixture(): {
  mindmapDB: MindmapDB;
  initialNodes: BaseFlowNode[];
  initialEdges: Edge[];
} {
  return {
    mindmapDB: {
      _id: "mindmaps:pill-fixture" as MindmapDB["_id"],
      publicId: "pill-map",
      name: "Pill fixture",
      visibility: "private",
      updatedAt: 1,
      isOwner: true,
    },
    initialNodes: [
      createBaseFlowNodeFromPartialBaseFlowNode({
        id: ROOT_NODE_ID,
        type: NodeTypes.ROOT,
        data: { title: "Root" },
      }),
      createBaseFlowNodeFromPartialBaseFlowNode({
        id: "right-child",
        type: NodeTypes.RIGHT,
        data: { title: "Right child" },
      }),
    ],
    initialEdges: [createEdge(ROOT_NODE_ID, "right-child")],
  };
}
