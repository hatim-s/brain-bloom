// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
import { MindmapFlowProvider } from "../providers/MindmapFlowProvider";
import { BaseFlowNode, NodeTypes } from "../types";
import { ShareMindmap } from "./ShareMindmap";

const mocks = vi.hoisted(() => ({
  setVisibility: vi.fn(),
  writeText: vi.fn(),
}));

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

    await waitFor(() =>
      expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe(
        "true"
      )
    );

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
      <ShareMindmap />
    </MindmapFlowProvider>
  );
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
