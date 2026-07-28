// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Edge } from "@xyflow/react";
import { ConvexError } from "convex/values";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { ROOT_NODE_ID } from "@/components/flow/const";
import { createEdge } from "@/components/flow/mindmap/createEdge";
import { createBaseFlowNodeFromPartialBaseFlowNode } from "@/components/flow/mindmap/createNode";
import { MindmapFlowProvider } from "@/components/flow/providers/MindmapFlowProvider";
import { BaseFlowNode, NodeTypes } from "@/components/flow/types";
import { MindmapDB } from "@/types/Mindmap";

import { AiPanel } from "./AiPanel";
import type { SprigUIMessage } from "./messages";
import type { UseSprigChat } from "./useSprigChat";

const mocks = vi.hoisted(() => ({
  chat: { current: null as unknown as UseSprigChat },
  refresh: vi.fn(),
  undoTo: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useMutation: () => mocks.undoTo,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

// Streamdown pulls a full markdown/katex/mermaid pipeline that the panel's
// behaviour does not depend on.
vi.mock("streamdown", () => ({
  Streamdown: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="markdown">{children}</div>
  ),
}));

vi.mock("./useSprigChat", () => ({
  useSprigChat: () => mocks.chat.current,
}));

/** Builds the chat surface state the panel renders against. */
function createChat(overrides: Partial<UseSprigChat> = {}): UseSprigChat {
  return {
    clearError: vi.fn(),
    error: undefined,
    isHistoryLoading: false,
    isStreaming: false,
    messages: [],
    sendPrompt: vi.fn(),
    startNewConversation: vi.fn(),
    status: "ready",
    stop: vi.fn(),
    ...overrides,
  };
}

/** An assistant turn that reported an applied Convex operation. */
function createTurnWithOperation(): SprigUIMessage {
  return {
    id: "assistant-1",
    role: "assistant",
    parts: [
      { type: "text", text: "Added a branch." },
      {
        type: "tool-createNodes",
        state: "output-available",
        input: {},
        output: { createdNodeIds: ["l-1"], operationId: "operations:1" },
      },
    ] as SprigUIMessage["parts"],
  };
}

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollTo ??= () => {};
});

beforeEach(() => {
  mocks.chat.current = createChat();
  mocks.refresh.mockReset();
  mocks.undoTo.mockReset().mockResolvedValue({ undoneCount: 1, seq: 4 });
});

afterEach(cleanup);

describe("AiPanel", () => {
  it("invites a first prompt when the thread is empty", () => {
    renderPanel();

    expect(
      screen.getByRole("region", { name: "Sprig assistant" })
    ).toBeDefined();
    expect(screen.getByText("Nothing here yet")).toBeDefined();
  });

  it("announces the canvas selection and sends it with the prompt", async () => {
    const user = userEvent.setup();
    const sendPrompt = vi.fn();
    mocks.chat.current = createChat({ sendPrompt });

    renderPanel();

    expect(screen.getByText("Working on:")).toBeDefined();
    expect(screen.getByText("Root")).toBeDefined();

    await user.type(screen.getByLabelText("Message Sprig"), "add three ideas");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    expect(sendPrompt).toHaveBeenCalledWith("add three ideas", ROOT_NODE_ID);
  });

  it("stops sending the selection once the chip is dismissed", async () => {
    const user = userEvent.setup();
    const sendPrompt = vi.fn();
    mocks.chat.current = createChat({ sendPrompt });

    renderPanel();

    await user.click(
      screen.getByRole("button", { name: "Stop working on Root" })
    );

    expect(screen.queryByText("Working on:")).toBeNull();

    await user.type(screen.getByLabelText("Message Sprig"), "rename the map");
    await user.click(screen.getByRole("button", { name: "Send message" }));

    expect(sendPrompt).toHaveBeenCalledWith("rename the map", null);
  });

  it("swaps send for stop and locks the composer while a turn streams", () => {
    const stop = vi.fn();
    mocks.chat.current = createChat({
      isStreaming: true,
      status: "streaming",
      stop,
    });

    renderPanel();

    expect(screen.getByLabelText("Sprig is working")).toBeDefined();
    expect(screen.getByLabelText("Message Sprig")).toHaveProperty(
      "disabled",
      true
    );
    expect(screen.queryByRole("button", { name: "Send message" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Stop generating" })
    ).toBeDefined();
  });

  it("shows a loading state instead of an empty thread during replay", () => {
    mocks.chat.current = createChat({ isHistoryLoading: true });

    renderPanel();

    expect(
      screen.getByRole("status", { name: "Loading conversation" })
    ).toBeDefined();
    expect(screen.queryByText("Nothing here yet")).toBeNull();
  });

  it("undoes back to the operation an assistant turn applied", async () => {
    const user = userEvent.setup();
    mocks.chat.current = createChat({ messages: [createTurnWithOperation()] });

    renderPanel();

    expect(screen.getByText("Added 1 node")).toBeDefined();

    await user.click(screen.getByRole("button", { name: /Undo to here/ }));

    expect(mocks.undoTo).toHaveBeenCalledWith({ operationId: "operations:1" });
    await waitFor(() =>
      expect(screen.getByText("Undone back to this change.")).toBeDefined()
    );
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("explains a rejected undo inline instead of failing silently", async () => {
    const user = userEvent.setup();
    // Rejecting from the implementation keeps the promise unborn until the
    // component actually calls it, so the runner sees no stray rejection.
    mocks.undoTo.mockImplementation(() =>
      Promise.reject(new ConvexError("Already undone"))
    );
    mocks.chat.current = createChat({ messages: [createTurnWithOperation()] });

    renderPanel();

    await user.click(screen.getByRole("button", { name: /Undo to here/ }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        "This change was already undone."
      )
    );
  });

  it("offers no undo on a turn that changed nothing", () => {
    mocks.chat.current = createChat({
      messages: [
        {
          id: "assistant-2",
          role: "assistant",
          parts: [{ type: "text", text: "The map already covers that." }],
        } as SprigUIMessage,
      ],
    });

    renderPanel();

    expect(screen.queryByRole("button", { name: /Undo to here/ })).toBeNull();
  });

  it("starts a fresh thread on request", async () => {
    const user = userEvent.setup();
    const startNewConversation = vi.fn();
    mocks.chat.current = createChat({
      messages: [createTurnWithOperation()],
      startNewConversation,
    });

    renderPanel();

    await user.click(screen.getByRole("button", { name: "New conversation" }));

    expect(startNewConversation).toHaveBeenCalled();
  });

  it("surfaces a failed turn with a dismissable alert", async () => {
    const user = userEvent.setup();
    const clearError = vi.fn();
    mocks.chat.current = createChat({
      clearError,
      error: new Error("stream failed"),
      status: "error",
    });

    renderPanel();

    expect(screen.getByRole("alert").textContent).toContain(
      "Sprig could not finish that"
    );

    await user.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(clearError).toHaveBeenCalled();
  });
});

/** Mounts the panel over a real mindmap store, as the canvas does. */
function renderPanel(): void {
  render(
    <MindmapFlowProvider {...createPanelFixture()}>
      <AiPanel onCollapse={vi.fn()} />
    </MindmapFlowProvider>
  );
}

/** Creates the smallest rooted graph the provider will accept. */
function createPanelFixture(): {
  mindmapDB: MindmapDB;
  initialNodes: BaseFlowNode[];
  initialEdges: Edge[];
} {
  return {
    mindmapDB: {
      _id: "mindmaps:panel-fixture" as MindmapDB["_id"],
      publicId: "panel-map",
      name: "Panel fixture",
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
