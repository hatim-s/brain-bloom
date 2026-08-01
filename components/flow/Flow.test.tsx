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

// The camera verbs the selection effect drives, shared across renders so a test
// can read what the canvas asked for and pretend the reader is zoomed out.
const camera = vi.hoisted(() => {
  const instance = {
    fitView: vi.fn(),
    getZoom: () => instance.zoom,
    zoom: 1,
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    zoomTo: vi.fn(),
  };

  return instance;
});

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
    minZoom,
    nodes,
    onNodeClick,
    onNodesChange,
  }: PropsWithChildren<{
    deleteKeyCode?: string | null;
    minZoom?: number;
    nodes: Array<{ id: string; className?: string; selected?: boolean }>;
    onNodeClick?: (event: unknown, node: { id: string }) => void;
    onNodesChange?: (
      changes: Array<
        | { id: string; type: "remove" }
        | { id: string; type: "select"; selected: boolean }
      >
    ) => void;
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
        data-min-zoom={minZoom}
      >
        {/* One click target per node, modelling XYFlow's own click sequence:
            selecting an unselected node and calling `onNodeClick` happen inside
            the same event, and clicking an already-selected node dispatches no
            change at all. Both paths decide whether the toolbar survives. */}
        {nodes.map((node) => (
          <button
            data-testid={`click-${node.id}`}
            key={node.id}
            onClick={() => {
              if (!node.selected) {
                onNodesChange?.([
                  { id: node.id, type: "select", selected: true },
                  ...nodes
                    .filter((other) => other.selected && other.id !== node.id)
                    .map(
                      (other) =>
                        ({
                          id: other.id,
                          type: "select",
                          selected: false,
                        }) as const
                    ),
                ]);
              }
              onNodeClick?.(undefined, node);
            }}
            type="button"
          >
            {node.id}
          </button>
        ))}
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
    // Without a real provider every store-backed hook has to be stubbed: the
    // canvas chrome reads the viewport and the zoom verbs, and stems read node
    // internals.
    // One instance for the whole suite, the way the real provider hands the
    // same object to every consumer — an identity that changed per render would
    // re-fire every effect that depends on it.
    useReactFlow: () => camera,
    useViewport: () => ({ x: 0, y: 0, zoom: 1 }),
    useInternalNode: (id: string) => ({
      id,
      measured: { width: 300, height: 64 },
      internals: { positionAbsolute: { x: 0, y: 0 } },
    }),
    // The harness has no real ReactFlowProvider, so the initial-fit effect's
    // measurement signal is stubbed as "already measured".
    useNodesInitialized: () => true,
  };
});

afterEach(() => {
  cleanup();
  camera.fitView.mockClear();
  camera.zoom = 1;
});

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

  it("keeps the context toolbar open on the node a pointer clicked", () => {
    const view = renderEditableCanvas();

    fireEvent.click(view.getByTestId("click-left-child"));

    // The selection change XYFlow dispatches alongside the click — and the one
    // the active-node sync effect replays right after it — carry the same id as
    // the toolbar, so neither may close it.
    expect(store.getState().activeNode).toBe("left-child");
    expect(store.getState().toolbarNode).toBe("left-child");
  });

  it("closes the toolbar when the selection moves to another node", () => {
    const view = renderEditableCanvas();

    fireEvent.click(view.getByTestId("click-left-child"));
    expect(store.getState().toolbarNode).toBe("left-child");

    // What an arrow key does: move the active node with no click behind it.
    act(() => store.getState().setActiveNode("root"));

    expect(store.getState().toolbarNode).toBeNull();
  });

  it("re-opens the toolbar on a second click of the selected node", () => {
    const view = renderEditableCanvas();

    fireEvent.click(view.getByTestId("click-left-child"));
    act(() => store.getState().setToolbarNode(null));

    // The node is already selected, so this click dispatches no change at all.
    fireEvent.click(view.getByTestId("click-left-child"));

    expect(store.getState().toolbarNode).toBe("left-child");
  });

  it("zooms an overview selection in to a readable size", async () => {
    // The reader is looking at the whole grove; centring the card without
    // closing in would leave it exactly as unreadable as it already was.
    camera.zoom = 0.2;
    renderEditableCanvas();
    camera.fitView.mockClear();

    act(() => store.getState().setActiveNode("left-child"));
    await flushAnimationFrame();

    expect(camera.fitView).toHaveBeenCalledWith({
      nodes: [{ id: "left-child" }],
      duration: 600,
      minZoom: 0.85,
      maxZoom: 1,
    });
  });

  it("never zooms a close camera back out to focus a node", async () => {
    camera.zoom = 1.6;
    renderEditableCanvas();
    camera.fitView.mockClear();

    act(() => store.getState().setActiveNode("left-child"));
    await flushAnimationFrame();

    expect(camera.fitView).toHaveBeenCalledWith({
      nodes: [{ id: "left-child" }],
      duration: 600,
      minZoom: 1.6,
      maxZoom: 1.6,
    });
  });

  it("selects the root when an arrow key arrives with nothing active", () => {
    renderEditableCanvas();
    act(() => store.getState().setActiveNode(null));

    fireEvent.keyDown(window, { key: "ArrowDown" });

    expect(store.getState().activeNode).toBe("root");
  });

  it("moves the selection with the arrow keys from the canvas", () => {
    renderEditableCanvas();
    act(() => store.getState().setActiveNode("root"));

    // Left from the root walks into the west hemisphere; the fixture's only
    // child is a left node.
    fireEvent.keyDown(window, { key: "ArrowLeft" });

    expect(store.getState().activeNode).toBe("left-child");
  });

  it("flags the ground while a root-to-active trail is lit", () => {
    const view = renderEditableCanvas();
    const ground = () => view.container.querySelector(".sprig-canvas");

    // Nothing selected: every stem rests at the same weight, so there is
    // nothing for the dimming rule to scope to.
    act(() => store.getState().setActiveNode(null));
    expect(ground()?.getAttribute("data-trail-active")).toBeNull();

    act(() => store.getState().setActiveNode("left-child"));
    expect(ground()?.getAttribute("data-trail-active")).toBe("true");

    // The root has no parent, so standing on it lights no trail either.
    act(() => store.getState().setActiveNode("root"));
    expect(ground()?.getAttribute("data-trail-active")).toBeNull();
  });

  it("lets the canvas zoom out far enough for a phone-width fit", () => {
    const view = render(<Flow mindmap={MINDMAP} nodes={NODES} readOnly />);

    expect(
      view
        .getByTestId("node-count")
        .parentElement?.getAttribute("data-min-zoom")
    ).toBe("0.05");
  });
});

/** Waits one animation frame, the beat the focus fit is deferred by. */
async function flushAnimationFrame() {
  await act(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  );
}

/** Renders the owner canvas, where the node toolbar and AI panel both exist. */
function renderEditableCanvas() {
  return render(
    <Flow
      mindmap={{ ...MINDMAP, isOwner: true }}
      nodes={NODES}
      readOnly={false}
    />
  );
}

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
