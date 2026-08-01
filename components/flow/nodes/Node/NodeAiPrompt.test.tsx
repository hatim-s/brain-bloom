// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { MindmapDB } from "@/types/Mindmap";

import { ROOT_NODE_ID } from "../../const";
import { createEdge } from "../../mindmap/createEdge";
import { createBaseFlowNodeFromPartialBaseFlowNode } from "../../mindmap/createNode";
import {
  MindmapFlowProvider,
  useMindmapStoreApi,
} from "../../providers/MindmapFlowProvider";
import { BaseFlowNode, NodeTypes } from "../../types";
import { ACTION_DEFAULT_PROMPTS, NodeAiPrompt } from "./NodeAiPrompt";
import { NodeContextToolbar } from "./NodeContextToolbar";

let store: ReturnType<typeof useMindmapStoreApi>;

afterEach(cleanup);

describe("NodeContextToolbar", () => {
  it("opens the inline prompt phrased around the chosen intent", async () => {
    const user = userEvent.setup();
    renderCanvasSurface(
      <NodeContextToolbar canEditFields nodeId="right-child" />
    );
    act(() => store.getState().setToolbarNode("right-child"));

    await user.click(screen.getByRole("button", { name: "Refine" }));

    const state = store.getState();
    expect(state.aiEditNode).toBe("right-child");
    expect(state.aiEditAction).toBe("refine");
    expect(state.toolbarNode).toBeNull();
    expect(state.selectedNode).toBeNull();
  });

  it("opens the field editor and withholds it from the root", async () => {
    const user = userEvent.setup();
    const { unmount } = renderCanvasSurface(
      <NodeContextToolbar canEditFields nodeId="right-child" />
    );

    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(store.getState().selectedNode).toBe("right-child");

    unmount();
    renderCanvasSurface(
      <NodeContextToolbar canEditFields={false} nodeId={ROOT_NODE_ID} />
    );
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });
});

describe("NodeAiPrompt", () => {
  it("queues the intent's default instruction on a bare Enter and closes", async () => {
    const user = userEvent.setup();
    renderCanvasSurface(<NodeAiPrompt />);
    act(() => {
      store.getState().setAiEditAction("grow");
      store.getState().setAiEditNode("right-child");
    });

    await user.type(screen.getByRole("textbox"), "{Enter}");

    const state = store.getState();
    expect(state.aiPromptRequest).toEqual({
      requestId: 1,
      nodeId: "right-child",
      prompt: ACTION_DEFAULT_PROMPTS.grow,
    });
    expect(state.aiEditNode).toBeNull();
  });

  it("sends the writer's own words when they typed any", async () => {
    const user = userEvent.setup();
    renderCanvasSurface(<NodeAiPrompt />);
    act(() => {
      store.getState().setAiEditAction("explain");
      store.getState().setAiEditNode("right-child");
    });

    await user.type(screen.getByRole("textbox"), "why does this matter{Enter}");

    expect(store.getState().aiPromptRequest).toEqual(
      expect.objectContaining({ prompt: "why does this matter" })
    );
  });

  it("closes without dispatching on Escape", async () => {
    const user = userEvent.setup();
    renderCanvasSurface(<NodeAiPrompt />);
    act(() => store.getState().setAiEditNode("right-child"));

    await user.type(screen.getByRole("textbox"), "{Escape}");

    const state = store.getState();
    expect(state.aiEditNode).toBeNull();
    expect(state.aiPromptRequest).toBeNull();
  });

  it("refuses to dispatch while a turn is already streaming", async () => {
    const user = userEvent.setup();
    renderCanvasSurface(<NodeAiPrompt />);
    act(() => {
      store.getState().setAiEditNode("right-child");
      store.getState().actions.setAiStreaming(true);
    });

    expect(
      screen.getByText("Sprig is still working — one change at a time.")
    ).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Send to Sprig" }));

    expect(store.getState().aiPromptRequest).toBeNull();
  });
});

/** Mounts one canvas-scoped surface over the smallest editable graph. */
function renderCanvasSurface(children: React.ReactNode) {
  return render(
    <TooltipProvider>
      <MindmapFlowProvider {...createCanvasFixture()}>
        <StoreProbe />
        {children}
      </MindmapFlowProvider>
    </TooltipProvider>
  );
}

/** Captures the provider store so tests can drive canvas state directly. */
function StoreProbe() {
  store = useMindmapStoreApi();
  return null;
}

/** Creates the smallest editable graph accepted by the provider. */
function createCanvasFixture(): {
  mindmapDB: MindmapDB;
  initialNodes: BaseFlowNode[];
  initialEdges: ReturnType<typeof createEdge>[];
} {
  return {
    mindmapDB: {
      _id: "mindmaps:prompt-fixture" as MindmapDB["_id"],
      publicId: "prompt-fixture",
      name: "Prompt fixture",
      updatedAt: 1,
      visibility: "private",
      isOwner: true,
    },
    initialNodes: [
      createBaseFlowNodeFromPartialBaseFlowNode({
        data: { title: "Root" },
        id: ROOT_NODE_ID,
        type: NodeTypes.ROOT,
      }),
      createBaseFlowNodeFromPartialBaseFlowNode({
        data: { title: "Right child" },
        id: "right-child",
        type: NodeTypes.RIGHT,
      }),
    ],
    initialEdges: [createEdge(ROOT_NODE_ID, "right-child")],
  };
}
