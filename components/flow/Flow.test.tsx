// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/react";
import { PropsWithChildren, useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MindmapDB, MindmapNodeProjection } from "@/types/Mindmap";

import Flow from "./Flow";

vi.mock("@/actions/mindmap", () => ({
  editMindmapWithAI: vi.fn(),
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
    nodes: Array<{ id: string; selected?: boolean }>;
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
});

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
