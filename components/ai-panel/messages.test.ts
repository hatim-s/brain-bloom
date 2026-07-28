import { describe, expect, it } from "vitest";

import {
  collectTouchedNodeIds,
  describeToolPart,
  getToolParts,
  getUndoOperationId,
  type SprigUIMessage,
  type ThreadMessageRecord,
  toUIMessages,
} from "./messages";

/** Builds an assistant turn from raw v7 parts without SDK ceremony. */
function createAssistantMessage(
  parts: unknown[],
  metadata?: { operationId?: string }
): SprigUIMessage {
  return {
    id: "assistant-1",
    role: "assistant",
    parts: parts as SprigUIMessage["parts"],
    ...(metadata === undefined ? {} : { metadata }),
  };
}

describe("getToolParts", () => {
  it("recognizes static and dynamic tool parts and ignores prose", () => {
    const message = createAssistantMessage([
      { type: "text", text: "Growing that branch." },
      { type: "step-start" },
      {
        type: "tool-createNodes",
        state: "output-available",
        input: {},
        output: {},
      },
      {
        type: "dynamic-tool",
        toolName: "updateNode",
        state: "input-available",
        input: { nodeId: "l-1" },
      },
    ]);

    expect(getToolParts(message).map((part) => part.toolName)).toEqual([
      "createNodes",
      "updateNode",
    ]);
  });
});

describe("describeToolPart", () => {
  it("counts created nodes once the tool output lands", () => {
    const [part] = getToolParts(
      createAssistantMessage([
        {
          type: "tool-createNodes",
          state: "output-available",
          input: {},
          output: {
            createdNodeIds: ["l-1", "l-2"],
            operationId: "operations:1",
          },
        },
      ])
    );

    expect(describeToolPart(part)).toEqual({
      label: "Added 2 nodes",
      status: "done",
    });
  });

  it("reports a still-running call without pretending it finished", () => {
    const [part] = getToolParts(
      createAssistantMessage([
        { type: "tool-moveNode", state: "input-streaming", input: {} },
      ])
    );

    expect(describeToolPart(part)).toEqual({
      label: "Moved a node",
      status: "running",
    });
  });

  it("surfaces a Convex rejection returned as tool output", () => {
    const [part] = getToolParts(
      createAssistantMessage([
        {
          type: "tool-deleteNode",
          state: "output-available",
          input: { nodeId: "l-1" },
          output: { error: "Invalid op: node has children" },
        },
      ])
    );

    expect(describeToolPart(part)).toEqual({
      label: "Invalid op: node has children",
      status: "error",
    });
  });
});

describe("collectTouchedNodeIds", () => {
  it("reads created ids from output and edited ids from input", () => {
    const message = createAssistantMessage([
      {
        type: "tool-createNodes",
        state: "output-available",
        input: {},
        output: { createdNodeIds: ["l-1", "l-2"] },
      },
      {
        type: "tool-updateNode",
        state: "output-available",
        input: { nodeId: "r-9" },
        output: { operationId: "operations:2" },
      },
      {
        type: "tool-moveNode",
        state: "output-available",
        input: { nodeId: "l-1", newParentId: "r-3" },
        output: { operationId: "operations:3" },
      },
    ]);

    expect(collectTouchedNodeIds(message)).toEqual([
      "l-1",
      "l-2",
      "r-9",
      "r-3",
    ]);
  });

  it("ignores rejected and unfinished calls", () => {
    const message = createAssistantMessage([
      {
        type: "tool-deleteNode",
        state: "output-available",
        input: { nodeId: "l-1" },
        output: { error: "Invalid op: node has children" },
      },
      {
        type: "tool-updateNode",
        state: "input-available",
        input: { nodeId: "r-2" },
      },
    ]);

    expect(collectTouchedNodeIds(message)).toEqual([]);
  });
});

describe("getUndoOperationId", () => {
  it("prefers the operation id persisted with the message", () => {
    const message = createAssistantMessage(
      [
        {
          type: "tool-updateNode",
          state: "output-available",
          input: { nodeId: "l-1" },
          output: { operationId: "operations:streamed" },
        },
      ],
      { operationId: "operations:persisted" }
    );

    expect(getUndoOperationId(message)).toBe("operations:persisted");
  });

  it("falls back to the last operation a streamed turn reported", () => {
    const message = createAssistantMessage([
      {
        type: "tool-createNodes",
        state: "output-available",
        input: {},
        output: { createdNodeIds: ["l-1"], operationId: "operations:1" },
      },
      {
        type: "tool-updateNode",
        state: "output-available",
        input: { nodeId: "l-1" },
        output: { operationId: "operations:2" },
      },
    ]);

    expect(getUndoOperationId(message)).toBe("operations:2");
  });

  it("returns null for a turn that changed nothing", () => {
    const message = createAssistantMessage([
      { type: "text", text: "Here is what the map already says." },
    ]);

    expect(getUndoOperationId(message)).toBeNull();
  });

  it("never offers undo on a user message", () => {
    const message: SprigUIMessage = {
      id: "user-1",
      role: "user",
      parts: [{ type: "text", text: "add three nodes" }],
      metadata: { operationId: "operations:1" },
    };

    expect(getUndoOperationId(message)).toBeNull();
  });
});

describe("toUIMessages", () => {
  it("replays persisted parts and re-attaches the operation link", () => {
    const records: ThreadMessageRecord[] = [
      {
        _id: "messages:1",
        role: "user",
        content: [{ type: "text", text: "add three nodes" }],
      },
      {
        _id: "messages:2",
        role: "assistant",
        content: [{ type: "text", text: "Done." }],
        operationId: "operations:1",
      },
    ];

    expect(toUIMessages(records)).toEqual([
      {
        id: "messages:1",
        role: "user",
        parts: [{ type: "text", text: "add three nodes" }],
      },
      {
        id: "messages:2",
        role: "assistant",
        parts: [{ type: "text", text: "Done." }],
        metadata: { operationId: "operations:1" },
      },
    ]);
  });

  it("drops records whose stored content is unusable", () => {
    const records: ThreadMessageRecord[] = [
      { _id: "messages:1", role: "assistant", content: null },
      { _id: "messages:2", role: "assistant", content: [] },
    ];

    expect(toUIMessages(records)).toEqual([]);
  });
});
