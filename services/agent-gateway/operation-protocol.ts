import { z } from "zod";

import type { GatewayOperation } from "./internal-auth.ts";

const GATEWAY_OPERATION_PROTOCOL_VERSION = 1;
const GATEWAY_CHAT_STREAM_CONTENT_TYPE =
  "application/vnd.sprig.chat-stream+octet-stream;version=1";
const MAX_IDENTIFIER_LENGTH = 256;
const MAX_INSTRUCTIONS_LENGTH = 8_192;
const MAX_PROMPT_LENGTH = 16_384;
const MAX_CONVERSATION_LENGTH = 32_000;
const MAX_TOOL_MANIFEST_LENGTH = 12_000;
const MAX_RAW_OUTPUT_LENGTH = 256_000;
const MAX_NODE_TEXT_LENGTH = 512;
const MAX_TREE_DEPTH = 10;
const MAX_TREE_NODES = 256;

const identifierSchema = z
  .string()
  .min(1)
  .max(MAX_IDENTIFIER_LENGTH)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const boundedTextSchema = (maximum: number) => z.string().min(1).max(maximum);

const ownedMindmapResourceSchema = z
  .object({ type: z.literal("owned-mindmap"), id: identifierSchema })
  .strict();
const ownerBootstrapResourceSchema = z
  .object({
    type: z.literal("owner-bootstrap"),
    intent: z.literal("create-first-mindmap"),
  })
  .strict();

const chatInputSchema = z
  .object({
    instructions: boundedTextSchema(MAX_INSTRUCTIONS_LENGTH),
    conversation: boundedTextSchema(MAX_CONVERSATION_LENGTH),
    toolManifest: z.string().max(MAX_TOOL_MANIFEST_LENGTH),
  })
  .strict();
const mindmapGenerationInputSchema = z
  .object({
    instructions: boundedTextSchema(MAX_INSTRUCTIONS_LENGTH),
    prompt: boundedTextSchema(MAX_PROMPT_LENGTH),
  })
  .strict();

const branchNodeSchema = z
  .object({
    nodeId: identifierSchema,
    title: boundedTextSchema(MAX_NODE_TEXT_LENGTH),
    description: z.string().max(MAX_NODE_TEXT_LENGTH).nullable(),
    link: z.string().max(MAX_NODE_TEXT_LENGTH).nullable(),
    childrenNodes: z.array(identifierSchema).max(32).optional(),
  })
  .strict();
const nodeEditingInputSchema = z
  .object({
    instructions: boundedTextSchema(MAX_INSTRUCTIONS_LENGTH),
    prompt: boundedTextSchema(MAX_PROMPT_LENGTH),
    activeNodeId: identifierSchema,
    currentBranch: z.array(branchNodeSchema).min(1).max(16),
  })
  .strict()
  .superRefine(({ activeNodeId, currentBranch }, context) => {
    if (!currentBranch.some((node) => node.nodeId === activeNodeId)) {
      context.addIssue({
        code: "custom",
        message: "active node must belong to the supplied branch",
      });
    }
    if (
      new Set(currentBranch.map((node) => node.nodeId)).size !==
      currentBranch.length
    ) {
      context.addIssue({
        code: "custom",
        message: "branch node ids must be unique",
      });
    }
  });

type GeneratedTreeNode = Readonly<{
  title: string;
  description?: string;
  link?: string;
  children: readonly GeneratedTreeNode[];
}>;

const generatedTreeNodeSchema: z.ZodType<GeneratedTreeNode> = z.lazy(() =>
  z
    .object({
      title: boundedTextSchema(MAX_NODE_TEXT_LENGTH),
      description: z.string().max(MAX_NODE_TEXT_LENGTH).optional(),
      link: z.string().max(MAX_NODE_TEXT_LENGTH).optional(),
      children: z.array(generatedTreeNodeSchema).max(3),
    })
    .strict()
);

const generatedMindmapOutputSchema = z
  .object({
    name: boundedTextSchema(MAX_NODE_TEXT_LENGTH),
    nodes: z.array(generatedTreeNodeSchema).min(1).max(6),
  })
  .strict();
const generatedNodeSuggestionsOutputSchema = z
  .object({ nodes: z.array(generatedTreeNodeSchema).min(1).max(3) })
  .strict();

const mindmapGenerationResultSchema = z
  .object({
    version: z.literal(GATEWAY_OPERATION_PROTOCOL_VERSION),
    operation: z.literal("mind-map-generation"),
    rawOutput: z.string().max(MAX_RAW_OUTPUT_LENGTH),
    output: generatedMindmapOutputSchema,
  })
  .strict();
const nodeEditingResultSchema = z
  .object({
    version: z.literal(GATEWAY_OPERATION_PROTOCOL_VERSION),
    operation: z.literal("node-editing"),
    rawOutput: z.string().max(MAX_RAW_OUTPUT_LENGTH),
    output: generatedNodeSuggestionsOutputSchema,
  })
  .strict();

const chatChunkSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("start") }).strict(),
  z.object({ type: z.literal("start-step") }).strict(),
  z.object({ type: z.literal("finish-step") }).strict(),
  z.object({ type: z.literal("text-start"), id: identifierSchema }).strict(),
  z
    .object({
      type: z.literal("text-delta"),
      id: identifierSchema,
      delta: z.string().max(MAX_NODE_TEXT_LENGTH * 8),
    })
    .strict(),
  z.object({ type: z.literal("text-end"), id: identifierSchema }).strict(),
  z
    .object({
      type: z.literal("tool-input-available"),
      toolCallId: identifierSchema,
      toolName: identifierSchema,
      input: z.json(),
      dynamic: z.literal(true),
    })
    .strict(),
  z
    .object({
      type: z.literal("tool-output-available"),
      toolCallId: identifierSchema,
      output: z.json(),
      dynamic: z.literal(true),
    })
    .strict(),
  z
    .object({
      type: z.literal("finish"),
      finishReason: z.enum([
        "stop",
        "length",
        "content-filter",
        "tool-calls",
        "error",
        "other",
        "unknown",
      ]),
    })
    .strict(),
  z.object({ type: z.literal("abort"), reason: z.string().max(256) }).strict(),
]);
const chatStreamFrameSchema = z
  .object({
    version: z.literal(GATEWAY_OPERATION_PROTOCOL_VERSION),
    event: chatChunkSchema,
  })
  .strict();

const chatEnvelopeSchema = z
  .object({
    version: z.literal(GATEWAY_OPERATION_PROTOCOL_VERSION),
    operation: z.literal("chat"),
    resource: ownedMindmapResourceSchema,
    input: chatInputSchema,
  })
  .strict();
const mindmapGenerationEnvelopeSchema = z
  .object({
    version: z.literal(GATEWAY_OPERATION_PROTOCOL_VERSION),
    operation: z.literal("mind-map-generation"),
    resource: ownerBootstrapResourceSchema,
    input: mindmapGenerationInputSchema,
  })
  .strict();
const nodeEditingEnvelopeSchema = z
  .object({
    version: z.literal(GATEWAY_OPERATION_PROTOCOL_VERSION),
    operation: z.literal("node-editing"),
    resource: ownedMindmapResourceSchema,
    input: nodeEditingInputSchema,
  })
  .strict();

type GatewayOwnedMindmapAuthority = z.infer<typeof ownedMindmapResourceSchema>;
type GatewayOwnerBootstrapAuthority = z.infer<
  typeof ownerBootstrapResourceSchema
>;
type GatewayResourceAuthority =
  | GatewayOwnedMindmapAuthority
  | GatewayOwnerBootstrapAuthority;
type GatewayChatInput = z.infer<typeof chatInputSchema>;
type GatewayMindmapGenerationInput = z.infer<
  typeof mindmapGenerationInputSchema
>;
type GatewayNodeEditingInput = z.infer<typeof nodeEditingInputSchema>;
type GatewayOperationInput =
  | GatewayChatInput
  | GatewayMindmapGenerationInput
  | GatewayNodeEditingInput;
type GatewayChatEnvelope = z.infer<typeof chatEnvelopeSchema>;
type GatewayMindmapGenerationEnvelope = z.infer<
  typeof mindmapGenerationEnvelopeSchema
>;
type GatewayNodeEditingEnvelope = z.infer<typeof nodeEditingEnvelopeSchema>;
type GatewayOperationEnvelope =
  | GatewayChatEnvelope
  | GatewayMindmapGenerationEnvelope
  | GatewayNodeEditingEnvelope;
type GatewayMindmapGenerationResult = z.infer<
  typeof mindmapGenerationResultSchema
>;
type GatewayNodeEditingResult = z.infer<typeof nodeEditingResultSchema>;
type GatewayActionResult =
  | GatewayMindmapGenerationResult
  | GatewayNodeEditingResult;
type GatewayChatChunk = z.infer<typeof chatChunkSchema>;

/** Validates one versioned envelope against its signed route and server authority. */
function parseGatewayOperationEnvelope(
  value: unknown,
  operation: GatewayOperation,
  expectedResource: GatewayResourceAuthority
): GatewayOperationEnvelope {
  const schema = schemaForOperation(operation);
  const envelope = schema.parse(value) as GatewayOperationEnvelope;
  if (!resourceAuthoritiesEqual(envelope.resource, expectedResource)) {
    throw new Error("Gateway resource authority mismatch");
  }
  return envelope;
}

/** Validates an action result against the exact operation that produced it. */
function parseGatewayActionResult(
  value: unknown,
  operation: "mind-map-generation" | "node-editing"
): GatewayActionResult {
  const result =
    operation === "mind-map-generation"
      ? mindmapGenerationResultSchema.parse(value)
      : nodeEditingResultSchema.parse(value);
  assertGatewayActionTreeBounds(result);
  return result;
}

/** Validates one gateway-produced chat event before transport serialization. */
function parseGatewayChatChunk(value: unknown): GatewayChatChunk {
  return chatChunkSchema.parse(value);
}

/** Parses one complete versioned NDJSON line into an application chat event. */
function parseGatewayChatStreamFrame(value: unknown): GatewayChatChunk {
  return chatStreamFrameSchema.parse(value).event;
}

/** Serializes one validated event as exactly one newline-delimited frame. */
function serializeGatewayChatStreamFrame(value: unknown): Uint8Array {
  const event = parseGatewayChatChunk(value);
  return new TextEncoder().encode(
    `${JSON.stringify({ version: GATEWAY_OPERATION_PROTOCOL_VERSION, event })}\n`
  );
}

/** Rejects pathological generated trees after structural parsing. */
function assertGatewayActionTreeBounds(result: GatewayActionResult): void {
  let nodes = 0;
  const visit = (node: GeneratedTreeNode, depth: number): void => {
    nodes += 1;
    if (depth > MAX_TREE_DEPTH || nodes > MAX_TREE_NODES) {
      throw new Error("Gateway action tree exceeds protocol bounds");
    }
    for (const child of node.children) visit(child, depth + 1);
  };
  for (const node of result.output.nodes) visit(node, 1);
}

/** Creates the only envelope variants accepted by the gateway protocol. */
function createGatewayOperationEnvelope(
  operation: GatewayOperation,
  resource: GatewayResourceAuthority,
  input: GatewayOperationInput
): GatewayOperationEnvelope {
  return parseGatewayOperationEnvelope(
    { version: GATEWAY_OPERATION_PROTOCOL_VERSION, operation, resource, input },
    operation,
    resource
  );
}

/** Selects one closed schema without allowing a caller-provided schema. */
function schemaForOperation(operation: GatewayOperation): z.ZodType {
  if (operation === "chat") return chatEnvelopeSchema;
  if (operation === "mind-map-generation") {
    return mindmapGenerationEnvelopeSchema;
  }
  return nodeEditingEnvelopeSchema;
}

/** Compares the complete closed authority variants without coercion. */
function resourceAuthoritiesEqual(
  left: GatewayResourceAuthority,
  right: GatewayResourceAuthority
): boolean {
  if (left.type !== right.type) return false;
  return left.type === "owned-mindmap"
    ? right.type === "owned-mindmap" && left.id === right.id
    : right.type === "owner-bootstrap" && left.intent === right.intent;
}

export {
  assertGatewayActionTreeBounds,
  createGatewayOperationEnvelope,
  GATEWAY_CHAT_STREAM_CONTENT_TYPE,
  GATEWAY_OPERATION_PROTOCOL_VERSION,
  type GatewayActionResult,
  type GatewayChatChunk,
  type GatewayChatEnvelope,
  type GatewayChatInput,
  type GatewayMindmapGenerationEnvelope,
  type GatewayMindmapGenerationInput,
  type GatewayMindmapGenerationResult,
  type GatewayNodeEditingEnvelope,
  type GatewayNodeEditingInput,
  type GatewayNodeEditingResult,
  type GatewayOperationEnvelope,
  type GatewayOperationInput,
  type GatewayOwnedMindmapAuthority,
  type GatewayOwnerBootstrapAuthority,
  type GatewayResourceAuthority,
  parseGatewayActionResult,
  parseGatewayChatChunk,
  parseGatewayChatStreamFrame,
  parseGatewayOperationEnvelope,
  serializeGatewayChatStreamFrame,
};
