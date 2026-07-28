// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/react";
import { Edge } from "@xyflow/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MindmapDB } from "@/types/Mindmap";

import { ROOT_NODE_ID } from "../const";
import { createEdge } from "../mindmap/createEdge";
import { createBaseFlowNodeFromPartialBaseFlowNode } from "../mindmap/createNode";
import { BaseFlowNode, NodeTypes } from "../types";
import { MindmapFlowProvider, useMindmapFlow } from "./MindmapFlowProvider";

afterEach(cleanup);

describe("MindmapFlowProvider", () => {
  it("re-renders a selected slice only when that slice changes", () => {
    const fixture = createProviderFixture();
    const onRender = vi.fn();
    const view = render(
      <MindmapFlowProvider {...fixture}>
        <StoreProbe onRender={onRender} />
      </MindmapFlowProvider>
    );

    expect(onRender).toHaveBeenCalledOnce();

    fireEvent.click(view.getByRole("button", { name: "Set active child" }));

    expect(view.getByTestId("active-node").textContent).toBe("l-child");
    expect(onRender).toHaveBeenCalledTimes(2);

    fireEvent.click(view.getByRole("button", { name: "Set selection" }));

    expect(onRender).toHaveBeenCalledTimes(2);
  });

  it("throws when the selector hook is used outside the provider", () => {
    expect(() => render(<OutsideProviderProbe />)).toThrow(
      "useMindmapFlow must be used within a MindmapFlowProvider"
    );
  });

  it("mounts cleanly under StrictMode", () => {
    const fixture = createProviderFixture();

    expect(() =>
      render(
        <StrictMode>
          <MindmapFlowProvider {...fixture}>
            <StoreProbe onRender={vi.fn()} />
          </MindmapFlowProvider>
        </StrictMode>
      )
    ).not.toThrow();
  });
});

/** Exposes selected store writes while recording renders of the active slice. */
function StoreProbe({ onRender }: { onRender: () => void }) {
  const activeNode = useMindmapFlow((state) => state.activeNode);
  const setActiveNode = useMindmapFlow((state) => state.setActiveNode);
  const setSelectedNode = useMindmapFlow((state) => state.setSelectedNode);
  onRender();

  return (
    <>
      <output data-testid="active-node">{activeNode}</output>
      <button type="button" onClick={() => setActiveNode("l-child")}>
        Set active child
      </button>
      <button type="button" onClick={() => setSelectedNode("l-child")}>
        Set selection
      </button>
    </>
  );
}

/** Exercises the provider guard without mounting a store. */
function OutsideProviderProbe() {
  useMindmapFlow((state) => state.activeNode);
  return null;
}

/** Creates a minimal rooted mindmap for provider wiring tests. */
function createProviderFixture(): {
  mindmapDB: MindmapDB;
  initialNodes: BaseFlowNode[];
  initialEdges: Edge[];
} {
  const initialNodes = [
    createBaseFlowNodeFromPartialBaseFlowNode({
      id: ROOT_NODE_ID,
      type: NodeTypes.ROOT,
      data: { title: "Root" },
    }),
    createBaseFlowNodeFromPartialBaseFlowNode({
      id: "l-child",
      type: NodeTypes.LEFT,
      data: { title: "Left child" },
    }),
  ];
  const initialEdges = [createEdge(ROOT_NODE_ID, "l-child")];
  const mindmapDB: MindmapDB = {
    _id: "mindmaps:provider-fixture" as MindmapDB["_id"],
    publicId: "provider-map",
    name: "Provider fixture",
    visibility: "private",
    updatedAt: 1,
    isOwner: true,
  };

  return { mindmapDB, initialNodes, initialEdges };
}
