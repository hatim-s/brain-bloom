// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Edge } from "@xyflow/react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { MindmapDB } from "@/types/Mindmap";

import { ROOT_NODE_ID } from "../const";
import { createEdge } from "../mindmap/createEdge";
import { createBaseFlowNodeFromPartialBaseFlowNode } from "../mindmap/createNode";
import {
  MindmapFlowProvider,
  useMindmapStoreApi,
} from "../providers/MindmapFlowProvider";
import { BaseFlowNode, NodeTypes } from "../types";
import { ShareMindmap } from "./ShareMindmap";

const mocks = vi.hoisted(() => ({
  setVisibility: vi.fn(),
  writeText: vi.fn(),
}));
let store: ReturnType<typeof useMindmapStoreApi>;

vi.mock("convex/react", () => ({
  useMutation: () => mocks.setVisibility,
}));

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

/**
 * Takes ownership of the clipboard after user-event has installed its own.
 *
 * jsdom ships none, and `userEvent.setup()` substitutes a stub of its own, so
 * the override has to be applied once the session exists or the component
 * would write into user-event's buffer instead of the spy.
 */
function stubClipboard(): void {
  Object.defineProperty(globalThis.navigator, "clipboard", {
    configurable: true,
    value: { writeText: mocks.writeText },
  });
}

beforeEach(() => {
  mocks.setVisibility.mockReset().mockResolvedValue(undefined);
  mocks.writeText.mockReset().mockResolvedValue(undefined);
});

afterEach(cleanup);

describe("ShareMindmap", () => {
  it("reads as private until the owner turns sharing on", async () => {
    const user = userEvent.setup();
    renderShareControl("private");

    await user.click(screen.getByRole("button", { name: "Sharing: private" }));

    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe(
      "false"
    );
    expect(
      screen.getByText(
        "Anyone with the link can view, without the conversation."
      )
    ).toBeDefined();
    expect(screen.queryByLabelText("Public link to this map")).toBeNull();
  });

  it("writes the new visibility and then reveals the public link", async () => {
    const user = userEvent.setup();
    renderShareControl("private");

    await user.click(screen.getByRole("button", { name: "Sharing: private" }));
    await user.click(screen.getByRole("switch"));

    expect(mocks.setVisibility).toHaveBeenCalledWith({
      mindmapId: "mindmaps:share-fixture",
      visibility: "shared",
    });

    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe(
      "false"
    );
    reseedVisibility("shared");

    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe(
      "true"
    );
    expect(screen.getByRole("status").textContent).toBe("Map is now shared");

    const link = screen.getByLabelText("Public link to this map");

    expect(link).toHaveProperty(
      "value",
      `${window.location.origin}/share/share-map`
    );
    expect(link).toHaveProperty("readOnly", true);
  });

  it("copies the public link to the clipboard and confirms it", async () => {
    const user = userEvent.setup();
    stubClipboard();
    renderShareControl("shared");

    await user.click(
      screen.getByRole("button", {
        name: "Sharing: anyone with the link can view",
      })
    );
    await user.click(screen.getByRole("button", { name: "Copy link" }));

    expect(mocks.writeText).toHaveBeenCalledWith(
      `${window.location.origin}/share/share-map`
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Link copied" })).toBeDefined()
    );
  });

  it("keeps the old state and explains a failed write", async () => {
    const user = userEvent.setup();
    mocks.setVisibility.mockImplementation(() =>
      Promise.reject(new Error("offline"))
    );
    renderShareControl("private");

    await user.click(screen.getByRole("button", { name: "Sharing: private" }));
    await user.click(screen.getByRole("switch"));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        "Couldn't change sharing just now. Try again."
      )
    );
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe(
      "false"
    );
    expect(screen.queryByLabelText("Public link to this map")).toBeNull();
  });

  it("keeps the pending switch focusable and ignores a second activation", async () => {
    const user = userEvent.setup();
    let resolve!: () => void;
    mocks.setVisibility.mockReturnValue(
      new Promise<void>((promiseResolve) => {
        resolve = promiseResolve;
      })
    );
    renderShareControl("private");

    await user.click(screen.getByRole("button", { name: "Sharing: private" }));
    const shareSwitch = screen.getByRole("switch");
    shareSwitch.focus();
    void user.click(shareSwitch);

    await waitFor(() =>
      expect(shareSwitch.getAttribute("aria-disabled")).toBe("true")
    );
    expect(shareSwitch).toHaveProperty("disabled", false);
    expect(document.activeElement).toBe(shareSwitch);
    await user.click(shareSwitch);
    expect(mocks.setVisibility).toHaveBeenCalledOnce();

    await act(async () => resolve());
  });

  it("reflects an external visibility reseed and announces revocation", () => {
    renderShareControl("shared");

    reseedVisibility("private");

    expect(
      screen.getByRole("button", { name: "Sharing: private" })
    ).toBeDefined();
    expect(screen.getByRole("status").textContent).toBe("Map is now private");
  });

  it("explains a clipboard the browser refused", async () => {
    const user = userEvent.setup();
    stubClipboard();
    mocks.writeText.mockImplementation(() =>
      Promise.reject(new Error("denied"))
    );
    renderShareControl("shared");

    await user.click(
      screen.getByRole("button", {
        name: "Sharing: anyone with the link can view",
      })
    );
    await user.click(screen.getByRole("button", { name: "Copy link" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        "Couldn't copy the link — select it instead."
      )
    );
  });
});

/** Mounts the control over a real store, the way the canvas rail does. */
function renderShareControl(visibility: MindmapDB["visibility"]): void {
  render(
    <MindmapFlowProvider {...createShareFixture(visibility)}>
      <StoreProbe />
      <ShareMindmap />
    </MindmapFlowProvider>
  );
}

/** Captures the real canvas store used as the sharing source of truth. */
function StoreProbe() {
  store = useMindmapStoreApi();
  return null;
}

/** Delivers the live server visibility update that follows a mutation. */
function reseedVisibility(visibility: MindmapDB["visibility"]): void {
  act(() => {
    const state = store.getState();
    state.actions.reseedFromServer({
      name: state.mindmapDB.name,
      nodes: [
        {
          nodeId: ROOT_NODE_ID,
          order: 0,
          parentId: null,
          title: "Root",
          type: "root",
        },
        {
          nodeId: "right-child",
          order: 0,
          parentId: ROOT_NODE_ID,
          title: "Right child",
          type: "right",
        },
      ],
      updatedAt: state.seededUpdatedAt + 1,
      visibility,
    });
  });
}

/** Creates the smallest rooted graph the provider will accept. */
function createShareFixture(visibility: MindmapDB["visibility"]): {
  mindmapDB: MindmapDB;
  initialNodes: BaseFlowNode[];
  initialEdges: Edge[];
} {
  return {
    mindmapDB: {
      _id: "mindmaps:share-fixture" as MindmapDB["_id"],
      publicId: "share-map",
      name: "Share fixture",
      visibility,
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
