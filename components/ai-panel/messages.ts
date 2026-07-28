import type { UIMessage } from "ai";

/**
 * Pure translation between what the chat route streams, what Convex persists,
 * and what the panel needs to render.
 *
 * Nothing here touches React or Convex clients, so every branch is directly
 * testable — which matters because the canvas itself cannot be exercised
 * without an authenticated session.
 */

/** The one metadata field the panel attaches to a persisted assistant turn. */
type SprigMessageMetadata = {
  operationId?: string;
};

type SprigUIMessage = UIMessage<SprigMessageMetadata>;

type SprigUIMessagePart = SprigUIMessage["parts"][number];

/** The shape `api.threads.listMessages` returns for one persisted message. */
type ThreadMessageRecord = {
  _id: string;
  messageId?: string | null;
  role: "user" | "assistant";
  content: unknown;
  operationId?: string | null;
};

/** Narrowed view of a v7 tool part, which the SDK types as a wide union. */
type ToolPartView = {
  toolName: string;
  state: string;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  errorText: string | null;
};

/** Tools whose target node id lives on the tool input rather than its output. */
const NODE_ID_INPUT_TOOLS = new Set(["updateNode", "deleteNode", "moveNode"]);

/** Short, past-tense labels for the tool activity strip under a message. */
const TOOL_LABELS: Record<string, string> = {
  createNodes: "Added nodes",
  deleteNode: "Removed a node",
  getHistory: "Checked history",
  moveNode: "Moved a node",
  readMindmap: "Read the map",
  renameMindmap: "Renamed the map",
  undoOperation: "Undid a change",
  updateNode: "Edited a node",
};

/** Returns the value at `key` when it is a plain record. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Returns `value` only when it is a non-empty string. */
function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Recognizes both static (`tool-createNodes`) and dynamic tool parts and
 * flattens them into one shape the panel can render without re-narrowing.
 */
function toToolPartView(part: SprigUIMessagePart): ToolPartView | null {
  const record = asRecord(part);
  const type = record === null ? null : asNonEmptyString(record.type);

  if (record === null || type === null) {
    return null;
  }

  const toolName =
    type === "dynamic-tool"
      ? asNonEmptyString(record.toolName)
      : type.startsWith("tool-")
        ? type.slice("tool-".length)
        : null;

  if (toolName === null) {
    return null;
  }

  return {
    toolName,
    state: asNonEmptyString(record.state) ?? "input-streaming",
    input: asRecord(record.input) ?? {},
    output: asRecord(record.output),
    errorText: asNonEmptyString(record.errorText),
  };
}

/** Returns every tool part on a message in stream order. */
function getToolParts(message: SprigUIMessage): ToolPartView[] {
  return message.parts
    .map(toToolPartView)
    .filter((part): part is ToolPartView => part !== null);
}

/**
 * Describes one tool call for the activity strip.
 *
 * The strip is deliberately terse: it exists so a writer can see *that* the
 * map changed and roughly how, not to reproduce the model's reasoning.
 */
function describeToolPart(part: ToolPartView): {
  label: string;
  status: "running" | "done" | "error";
} {
  const rejection =
    part.output === null ? null : asNonEmptyString(part.output.error);
  const label = TOOL_LABELS[part.toolName] ?? part.toolName;

  if (part.state === "output-error" || rejection !== null) {
    return {
      label: part.errorText ?? rejection ?? `${label} failed`,
      status: "error",
    };
  }

  if (part.state !== "output-available") {
    return { label, status: "running" };
  }

  if (
    part.toolName === "createNodes" &&
    Array.isArray(part.output?.createdNodeIds)
  ) {
    const count = part.output.createdNodeIds.length;
    return {
      label: `Added ${count} node${count === 1 ? "" : "s"}`,
      status: "done",
    };
  }

  return { label, status: "done" };
}

/**
 * Collects the node ids one assistant turn created or edited.
 *
 * Creations report their ids on the tool output; every other mutation names
 * its target on the input, because the output only carries the operation id.
 */
function collectTouchedNodeIds(message: SprigUIMessage): string[] {
  const nodeIds = new Set<string>();

  for (const part of getToolParts(message)) {
    if (part.state !== "output-available" || part.output === null) {
      continue;
    }

    if (asNonEmptyString(part.output.error) !== null) {
      continue;
    }

    if (Array.isArray(part.output.createdNodeIds)) {
      for (const nodeId of part.output.createdNodeIds) {
        const id = asNonEmptyString(nodeId);
        if (id !== null) nodeIds.add(id);
      }
    }

    if (NODE_ID_INPUT_TOOLS.has(part.toolName)) {
      const nodeId = asNonEmptyString(part.input.nodeId);
      if (nodeId !== null) nodeIds.add(nodeId);

      // A move re-lays out the destination branch, so the new parent blooms too.
      const newParentId = asNonEmptyString(part.input.newParentId);
      if (newParentId !== null) nodeIds.add(newParentId);
    }
  }

  return Array.from(nodeIds);
}

/**
 * Resolves the operation an assistant turn can be undone back to.
 *
 * Persisted messages carry the id the route linked at write time. A turn that
 * is still in this session's memory has no metadata yet, so the last operation
 * id reported by a tool is used instead. The first successful mutation is the
 * undo target because undoTo(first) reverses the whole turn.
 */
function getUndoOperationId(message: SprigUIMessage): string | null {
  if (message.role !== "assistant") {
    return null;
  }

  const persisted = asNonEmptyString(message.metadata?.operationId);
  if (persisted !== null) {
    return persisted;
  }

  for (const part of getToolParts(message)) {
    if (part.state !== "output-available" || part.output === null) {
      continue;
    }

    const operationId = asNonEmptyString(part.output.operationId);
    if (operationId !== null) {
      return operationId;
    }
  }

  return null;
}

/**
 * Converts persisted thread messages into the v7 shape `useChat` renders.
 *
 * Convex stores the parts array verbatim, so replaying a thread is a matter of
 * re-attaching ids and the operation link rather than re-deriving content.
 */
function toUIMessages(
  records: readonly ThreadMessageRecord[]
): SprigUIMessage[] {
  return records.flatMap((record): SprigUIMessage[] => {
    if (!Array.isArray(record.content) || record.content.length === 0) {
      return [];
    }

    const operationId = asNonEmptyString(record.operationId);

    return [
      {
        id: asNonEmptyString(record.messageId) ?? record._id,
        role: record.role,
        parts: record.content as SprigUIMessage["parts"],
        ...(operationId === null ? {} : { metadata: { operationId } }),
      },
    ];
  });
}

export {
  collectTouchedNodeIds,
  describeToolPart,
  getToolParts,
  getUndoOperationId,
  type SprigMessageMetadata,
  type SprigUIMessage,
  type ThreadMessageRecord,
  type ToolPartView,
  toUIMessages,
};
