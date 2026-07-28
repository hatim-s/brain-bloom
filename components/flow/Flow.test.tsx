// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { PropsWithChildren, useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AI_TOUCH_DURATION_MS } from "@/components/ai-panel/constants";
import { MindmapDB, MindmapNodeProjection } from "@/types/Mindmap";

import Flow from "./Flow";
import { useMindmapStoreApi } from "./providers/MindmapFlowProvider";

vi.mock("@/actions/mindmap", () => ({
  editMindmapWithAI: vi.fn(),
}));

vi.mock("next/dynamic", () => ({
  default: () =>
    function DynamicPanelHarness({ children }: PropsWithChildren) {
      return (
        <>
          <StoreHandle />
          {children}
        </>
      );
    },
}));

// The panel needs Convex and the AI SDK; this suite is about the canvas it
// wraps, so the shell is reduced to a pass-through plus a store handle.
vi.mock("@/components/ai-panel/AiPanelLayout", () => ({
  AiPanelLayout: ({ children }: PropsWithChildren) => (
    <>
      <StoreHandle />
      {children}
    </>
  ),
}));

// Autosave and the share control own Convex mutations that this suite has no
// client for; the canvas behaviour under test does not depend on either.
vi.mock("convex/react", () => ({
  useMutation: () => vi.fn(),
}));

vi.mock("./hooks/useMindmapSync", () => ({
  useMindmapSync: () => {},
}));

vi.mock("./hooks/useMindmapLiveSync", () => ({
  useMindmapLiveSync: () => {},
}));

vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>();

  /**
   * Models XYFlow's default Backspace behavior while exposing the configured
   * deletion key for the read-only regression.
   */
  function ReactFlowHarness({
    children,
    deleteKeyCode = "Backspace",
    nodes,
    onNodesChange,
  }: PropsWithChildren<{
    deleteKeyCode?: string | null;
    nodes: Array<{ id: string; className?: string; selected?: boolean }>;
    onNodesChange?: (changes: Array<{ id: string; type: "remove" }>) => void;
  }>) {
    useEffect(() => {
      /** Applies the library's default selected-node removal shortcut. */
      const handleKeyDown = (event: KeyboardEvent) => {
        const selectedNode = nodes.find((node) => node.selected);
        if (deleteKeyCode === event.key && selectedNode) {
          onNodesChange?.([{ id: selectedNode.id, type: "remove" }]);
        }
      };

      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }, [deleteKeyCode, nodes, onNodesChange]);

    return (
      <div
        data-delete-key={deleteKeyCode === null ? "disabled" : deleteKeyCode}
      >
        <output data-testid="node-count">{nodes.length}</output>
        <output data-testid="selected-count">
          {nodes.filter((node) => node.selected).length}
        </output>
        <output data-testid="bloomed-nodes">
          {nodes
            .filter((node) => node.className?.includes("sprig-ai-touched"))
            .map((node) => node.id)
            .join(",")}
        </output>
        {children}
      </div>
    );
  }

  /** Keeps the unit harness focused on Flow configuration and store behavior. */
  function ReactFlowProviderHarness({ children }: PropsWithChildren) {
    return children;
  }

  return {
    ...actual,
    Background: () => null,
    ReactFlow: ReactFlowHarness,
    ReactFlowProvider: ReactFlowProviderHarness,
    useReactFlow: () => ({
      fitView: vi.fn(),
      getZoom: () => 1,
    }),
  };
});

afterEach(cleanup);

describe("Flow", () => {
  it("keeps a selected node after Backspace in read-only mode", () => {
    const view = render(<Flow mindmap={MINDMAP} nodes={NODES} readOnly />);

    expect(view.getByTestId("node-count").textContent).toBe("2");
    expect(view.getByTestId("selected-count").textContent).toBe("1");
    expect(
      view
        .getByTestId("node-count")
        .parentElement?.getAttribute("data-delete-key")
    ).toBe("disabled");

    fireEvent.keyDown(window, { key: "Backspace" });

    expect(view.getByTestId("node-count").textContent).toBe("2");
  });

  it("keeps the AI panel off a read-only canvas", () => {
    const view = render(<Flow mindmap={MINDMAP} nodes={NODES} readOnly />);

    expect(view.queryByTestId("store-handle")).toBeNull();
  });

  it("blooms AI-touched nodes and lets the pulse settle", () => {
    vi.useFakeTimers();

    try {
      const view = render(
        <Flow
          mindmap={{ ...MINDMAP, isOwner: true }}
          nodes={NODES}
          readOnly={false}
        />
      );

      expect(view.getByTestId("store-handle")).toBeDefined();
      expect(view.getByTestId("bloomed-nodes").textContent).toBe("");

      act(() => store.getState().setAiTouchedNodeIds(["left-child"]));

      expect(view.getByTestId("bloomed-nodes").textContent).toBe("left-child");

      // The highlight is a pulse of attention, not a permanent badge.
      act(() => vi.advanceTimersByTime(AI_TOUCH_DURATION_MS));

      expect(view.getByTestId("bloomed-nodes").textContent).toBe("");
    } finally {
      vi.useRealTimers();
    }
  });

  it("blooms an AI-created node after the server reseed mounts it", () => {
    const view = render(
      <Flow
        mindmap={{ ...MINDMAP, isOwner: true }}
        nodes={NODES}
        readOnly={false}
      />
    );

    act(() => {
      store
        .getState()
        .actions.setAiTouchedNodeIdsAfterReseed(["l-ai-created"], 1);
      store.getState().actions.reseedFromServer({
        name: MINDMAP.name,
        updatedAt: 2,
        visibility: MINDMAP.visibility,
        nodes: [
          ...NODES,
          {
            nodeId: "l-ai-created",
            parentId: "root",
            type: "left",
            title: "AI created",
            order: 0,
          },
        ],
      });
    });

    expect(view.getByTestId("bloomed-nodes").textContent).toBe("l-ai-created");
  });

  it("re-dispatches the active selection after a server reseed", () => {
    const view = render(
      <Flow
        mindmap={{ ...MINDMAP, isOwner: true }}
        nodes={NODES}
        readOnly={false}
      />
    );

    act(() => store.getState().setActiveNode("left-child"));
    expect(view.getByTestId("selected-count").textContent).toBe("1");

    act(() => {
      store.getState().actions.reseedFromServer({
        name: MINDMAP.name,
        nodes: NODES.map((node) =>
          node.nodeId === "left-child"
            ? { ...node, title: "Server title" }
            : node
        ),
        updatedAt: 2,
        visibility: MINDMAP.visibility,
      });
    });

    expect(view.getByTestId("selected-count").textContent).toBe("1");
  });
});

let store: ReturnType<typeof useMindmapStoreApi>;

/** Captures the canvas store from inside the provider the way the panel does. */
function StoreHandle() {
  store = useMindmapStoreApi();
  return <span data-testid="store-handle" />;
}

const MINDMAP: MindmapDB = {
  _id: "mindmaps:flow-fixture" as MindmapDB["_id"],
  publicId: "flow-map",
  name: "Flow fixture",
  visibility: "shared",
  updatedAt: 1,
  isOwner: false,
};

const NODES: MindmapNodeProjection[] = [
  {
    nodeId: "root",
    parentId: null,
    type: "root",
    title: "Root",
    order: 0,
  },
  {
    nodeId: "left-child",
    parentId: "root",
    type: "left",
    title: "Left child",
    order: 0,
  },
];
