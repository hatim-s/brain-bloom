// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MindmapDB, MindmapNodeProjection } from "@/types/Mindmap";

import { ROOT_NODE_ID } from "../const";
import { NodeTypes } from "../types";
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

  it("mounts an authenticated non-owner in read-only mode", () => {
    const fixture = createProviderFixture();
    const nonOwnerMindmap = { ...fixture.mindmapDB, isOwner: false };
    const view = render(
      <MindmapFlowProvider
        {...fixture}
        mindmapDB={nonOwnerMindmap}
        readOnly={!nonOwnerMindmap.isOwner}
      >
        <ReadOnlyProbe />
      </MindmapFlowProvider>
    );

    expect(view.getByTestId("read-only").textContent).toBe("true");
  });

  it("seeds empty and root-only server snapshots exactly as received", () => {
    const fixture = createProviderFixture();
    const empty = render(
      <MindmapFlowProvider {...fixture} serverNodes={[]}>
        <SeedProbe />
      </MindmapFlowProvider>
    );

    expect(empty.getByTestId("node-ids").textContent).toBe("");
    expect(empty.getByTestId("edge-count").textContent).toBe("0");
    empty.unmount();

    const rootOnly = render(
      <MindmapFlowProvider
        {...fixture}
        serverNodes={[
          {
            nodeId: ROOT_NODE_ID,
            order: 0,
            parentId: null,
            title: "Server root",
            type: "root",
          },
        ]}
      >
        <SeedProbe />
      </MindmapFlowProvider>
    );

    expect(rootOnly.getByTestId("node-ids").textContent).toBe(ROOT_NODE_ID);
    expect(rootOnly.getByTestId("node-titles").textContent).toBe("Server root");
    expect(rootOnly.getByTestId("edge-count").textContent).toBe("0");
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

/** Exposes the provider's ownership-derived interaction mode. */
function ReadOnlyProbe() {
  const readOnly = useMindmapFlow((state) => state.readOnly);
  return <output data-testid="read-only">{String(readOnly)}</output>;
}

/** Reports the graph contents seeded into the provider's isolated store. */
function SeedProbe() {
  const nodes = useMindmapFlow((state) => state.nodes);
  const edgeCount = useMindmapFlow((state) => state.edges.length);

  return (
    <>
      <output data-testid="node-ids">
        {nodes.map((node) => node.id).join(",")}
      </output>
      <output data-testid="node-titles">
        {nodes.map((node) => node.data.title).join(",")}
      </output>
      <output data-testid="edge-count">{edgeCount}</output>
    </>
  );
}

/** Creates a minimal rooted mindmap for provider wiring tests. */
function createProviderFixture(): {
  mindmapDB: MindmapDB;
  serverNodes: MindmapNodeProjection[];
} {
  const mindmapDB: MindmapDB = {
    _id: "mindmaps:provider-fixture" as MindmapDB["_id"],
    publicId: "provider-map",
    name: "Provider fixture",
    visibility: "private",
    updatedAt: 1,
    isOwner: true,
  };

  return {
    mindmapDB,
    serverNodes: [
      {
        nodeId: ROOT_NODE_ID,
        order: 0,
        parentId: null,
        title: "Root",
        type: NodeTypes.ROOT,
      },
      {
        nodeId: "l-child",
        order: 0,
        parentId: ROOT_NODE_ID,
        title: "Left child",
        type: NodeTypes.LEFT,
      },
    ],
  };
}
