import { describe, expect, it } from "vitest";

import {
  createGatewayOperationEnvelope,
  parseGatewayActionResult,
  parseGatewayChatStreamFrame,
  parseGatewayOperationEnvelope,
  serializeGatewayChatStreamFrame,
} from "./operation-protocol.ts";

const ownedResource = { type: "owned-mindmap", id: "map-1" } as const;
const bootstrapResource = {
  type: "owner-bootstrap",
  intent: "create-first-mindmap",
} as const;

/** Creates one valid generated node at an explicit recursive depth. */
function generatedNode(depth = 1): {
  title: string;
  children: ReturnType<typeof generatedNode>[];
} {
  return {
    title: `node-${depth}`,
    children: depth > 1 ? [generatedNode(depth - 1)] : [],
  };
}

describe("gateway operation protocol", () => {
  it("accepts all three closed versioned operation envelopes", () => {
    expect(
      createGatewayOperationEnvelope("chat", ownedResource, {
        instructions: "Help with this map",
        conversation: "user: explain the root",
        toolManifest: "[]",
      })
    ).toMatchObject({ version: 1, operation: "chat" });
    expect(
      createGatewayOperationEnvelope("mind-map-generation", bootstrapResource, {
        instructions: "Generate a map",
        prompt: "Distributed systems",
      })
    ).toMatchObject({ version: 1, operation: "mind-map-generation" });
    expect(
      createGatewayOperationEnvelope("node-editing", ownedResource, {
        instructions: "Extend a branch",
        prompt: "Add examples",
        activeNodeId: "node-1",
        currentBranch: [
          {
            nodeId: "node-1",
            title: "Root",
            description: null,
            link: null,
          },
        ],
      })
    ).toMatchObject({ version: 1, operation: "node-editing" });
  });

  it("binds operation and complete canonical resource authority exactly", () => {
    const envelope = createGatewayOperationEnvelope("chat", ownedResource, {
      instructions: "Help",
      conversation: "user: hello",
      toolManifest: "[]",
    });
    expect(() =>
      parseGatewayOperationEnvelope(envelope, "node-editing", ownedResource)
    ).toThrow();
    expect(() =>
      parseGatewayOperationEnvelope(envelope, "chat", {
        type: "owned-mindmap",
        id: "map-2",
      })
    ).toThrow();
    expect(() =>
      parseGatewayOperationEnvelope(envelope, "chat", bootstrapResource)
    ).toThrow();
  });

  it("rejects extra fields, oversized text, and ambiguous first-map authority", () => {
    expect(() =>
      createGatewayOperationEnvelope("chat", ownedResource, {
        instructions: "x",
        conversation: "x".repeat(32_001),
        toolManifest: "[]",
      })
    ).toThrow();
    expect(() =>
      parseGatewayOperationEnvelope(
        {
          version: 1,
          operation: "mind-map-generation",
          resource: { ...bootstrapResource, ownerId: "forged-owner" },
          input: { instructions: "Generate", prompt: "Topic" },
        },
        "mind-map-generation",
        bootstrapResource
      )
    ).toThrow();
  });

  it("requires node-edit authority to include the active branch node exactly once", () => {
    expect(() =>
      createGatewayOperationEnvelope("node-editing", ownedResource, {
        instructions: "Extend",
        prompt: "Examples",
        activeNodeId: "missing",
        currentBranch: [
          {
            nodeId: "node-1",
            title: "Root",
            description: null,
            link: null,
          },
        ],
      })
    ).toThrow();
  });

  it("validates fixed action results and enforces total depth", () => {
    expect(
      parseGatewayActionResult(
        {
          version: 1,
          operation: "mind-map-generation",
          rawOutput: "raw",
          output: { name: "Map", nodes: [generatedNode()] },
        },
        "mind-map-generation"
      )
    ).toMatchObject({ operation: "mind-map-generation" });
    expect(() =>
      parseGatewayActionResult(
        {
          version: 1,
          operation: "node-editing",
          rawOutput: "raw",
          output: { nodes: [generatedNode(11)] },
        },
        "node-editing"
      )
    ).toThrow();
  });

  it("round-trips only closed versioned chat events", () => {
    const event = {
      type: "tool-output-available",
      toolCallId: "tool-1",
      output: { operationId: "operation-1" },
      dynamic: true,
    } as const;
    const encoded = serializeGatewayChatStreamFrame(event);
    expect(
      parseGatewayChatStreamFrame(
        JSON.parse(new TextDecoder().decode(encoded).trim())
      )
    ).toEqual(event);
    expect(() =>
      parseGatewayChatStreamFrame({
        version: 1,
        event: { type: "shell-output", secret: "canary" },
      })
    ).toThrow();
  });
});
