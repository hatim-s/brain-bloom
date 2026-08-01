// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Edge } from "@xyflow/react";
import { afterEach, describe, expect, it } from "vitest";

import { MindmapDB } from "@/types/Mindmap";

import { ROOT_NODE_ID } from "../../const";
import { createEdge } from "../../mindmap/createEdge";
import { createBaseFlowNodeFromPartialBaseFlowNode } from "../../mindmap/createNode";
import {
  MindmapFlowProvider,
  useMindmapStoreApi,
} from "../../providers/MindmapFlowProvider";
import { BaseFlowNode, NodeTypes } from "../../types";
import { NodeDataInput } from "./NodeDataInput";

let store: ReturnType<typeof useMindmapStoreApi>;

afterEach(cleanup);

describe("NodeDataInput", () => {
  it("edits the node in place: title, description, and link fields", () => {
    renderEditor();

    expect(screen.getByLabelText("Title")).toHaveProperty(
      "value",
      "Original title"
    );
    expect(screen.getByLabelText("Description")).toHaveProperty(
      "value",
      "Original description"
    );
    expect(screen.getByLabelText("Link")).toHaveProperty("value", "");
    // The link row is one affordance line: nothing to open, nothing shown.
    expect(
      screen.queryByRole("button", { name: "Open link in a new tab" })
    ).toBeNull();
  });

  it("reveals the open-in-new-tab affordance once a link is typed", async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.type(screen.getByLabelText("Link"), "example.com");

    expect(
      screen.getByRole("button", { name: "Open link in a new tab" })
    ).toBeDefined();
  });

  it("saves the card's fields on Enter and closes", async () => {
    const user = userEvent.setup();
    renderEditor();

    const title = screen.getByLabelText("Title");
    await user.clear(title);
    await user.type(title, "Edited title{Enter}");

    const state = store.getState();
    expect(state.selectedNode).toBeNull();
    expect(state.nodesMap["right-child"].data).toEqual(
      expect.objectContaining({
        title: "Edited title",
        description: "Original description",
      })
    );
  });

  it("keeps typing a newline inside the description on Shift+Enter", async () => {
    const user = userEvent.setup();
    renderEditor();

    const description = screen.getByLabelText("Description");
    await user.click(description);
    await user.keyboard("{Shift>}{Enter}{/Shift}");

    expect(store.getState().selectedNode).toBe("right-child");
  });

  it("closes without saving on Escape", async () => {
    const user = userEvent.setup();
    renderEditor();

    const title = screen.getByLabelText("Title");
    await user.clear(title);
    await user.type(title, "Discarded title");
    await user.keyboard("{Escape}");

    const state = store.getState();
    expect(state.selectedNode).toBeNull();
    expect(state.nodesMap["right-child"].data.title).toBe("Original title");
  });

  it("cycles focus through the card's own fields on Tab", async () => {
    const user = userEvent.setup();
    renderEditor();

    const title = screen.getByLabelText("Title");
    await user.click(title);
    await user.keyboard("{Tab}");
    expect(document.activeElement).toBe(screen.getByLabelText("Description"));

    await user.keyboard("{Tab}");
    expect(document.activeElement).toBe(screen.getByLabelText("Link"));
  });

  it("wraps Tab from the last stop back to the title", async () => {
    const user = userEvent.setup();
    renderEditor();

    screen.getByRole("button", { name: "Save" }).focus();
    await user.keyboard("{Tab}");

    expect(document.activeElement).toBe(screen.getByLabelText("Title"));
  });

  it("updates an untouched field when the server reseeds the node", () => {
    renderEditor();

    reseedNode({ description: "Server description", title: "Server title" });

    expect(screen.getByLabelText("Title")).toHaveProperty(
      "value",
      "Server title"
    );
    expect(screen.getByLabelText("Description")).toHaveProperty(
      "value",
      "Server description"
    );
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("keeps a touched field and warns when the server changes it", async () => {
    const user = userEvent.setup();
    renderEditor();

    const title = screen.getByLabelText("Title");
    await user.clear(title);
    await user.type(title, "My local title");
    reseedNode({ description: "Server description", title: "Server title" });

    expect(title).toHaveProperty("value", "My local title");
    expect(screen.getByLabelText("Description")).toHaveProperty(
      "value",
      "Server description"
    );
    expect(screen.getByRole("status").textContent).toBe(
      "This node changed elsewhere — saving will overwrite."
    );
  });
});

/** Mounts the real editor over a selected node in the canvas store. */
function renderEditor(): void {
  render(
    <MindmapFlowProvider {...createEditorFixture()}>
      <StoreProbe />
      <NodeDataInput />
    </MindmapFlowProvider>
  );

  act(() => store.getState().setSelectedNode("right-child"));
}

/** Captures the provider store so tests can deliver a live server reseed. */
function StoreProbe() {
  store = useMindmapStoreApi();
  return null;
}

/** Replaces the selected node with a newer server projection. */
function reseedNode(data: { description: string; title: string }): void {
  act(() => {
    store.getState().actions.reseedFromServer({
      name: "Editor fixture",
      nodes: [
        {
          nodeId: ROOT_NODE_ID,
          order: 0,
          parentId: null,
          title: "Root",
          type: "root",
        },
        {
          description: data.description,
          nodeId: "right-child",
          order: 0,
          parentId: ROOT_NODE_ID,
          title: data.title,
          type: "right",
        },
      ],
      updatedAt: 2,
      visibility: "private",
    });
  });
}

/** Creates the smallest editable graph accepted by the provider. */
function createEditorFixture(): {
  mindmapDB: MindmapDB;
  initialNodes: BaseFlowNode[];
  initialEdges: Edge[];
} {
  return {
    mindmapDB: {
      _id: "mindmaps:editor-fixture" as MindmapDB["_id"],
      isOwner: true,
      name: "Editor fixture",
      publicId: "editor-map",
      updatedAt: 1,
      visibility: "private",
    },
    initialNodes: [
      createBaseFlowNodeFromPartialBaseFlowNode({
        data: { title: "Root" },
        id: ROOT_NODE_ID,
        type: NodeTypes.ROOT,
      }),
      createBaseFlowNodeFromPartialBaseFlowNode({
        data: { description: "Original description", title: "Original title" },
        id: "right-child",
        type: NodeTypes.RIGHT,
      }),
    ],
    initialEdges: [createEdge(ROOT_NODE_ID, "right-child")],
  };
}
