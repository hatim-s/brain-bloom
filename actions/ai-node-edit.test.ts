import { describe, expect, it, vi } from "vitest";

import { flattenSuggestions } from "@/lib/ai/nodeSuggestions";

import { editAIMindmap } from "./ai-node-edit";

const mocks = vi.hoisted(() => ({
  generateRoutedAIStructured: vi.fn(),
}));

vi.mock("@/lib/ai/executionRouter", () => ({
  generateRoutedAIStructured: mocks.generateRoutedAIStructured,
}));

describe("flattenSuggestions", () => {
  it("appends generated children after the active node's existing children", () => {
    const [activeNode] = flattenSuggestions(
      [
        { title: "Generated one", children: [] },
        { title: "Generated two", children: [] },
      ],
      {
        nodeId: "active",
        title: "Active",
        description: null,
        link: null,
        childrenNodes: ["existing-one", "existing-two"],
      }
    );

    expect(activeNode?.childrenNodes).toEqual([
      "existing-one",
      "existing-two",
      "suggestion-1",
      "suggestion-2",
    ]);
  });
});

describe("editAIMindmap", () => {
  it("selects node editing through the shared request execution router", async () => {
    mocks.generateRoutedAIStructured.mockResolvedValueOnce({
      rawOutput: '{"nodes":[{"title":"Generated","children":[]}]}',
      output: { nodes: [{ title: "Generated", children: [] }] },
    });
    const currentBranch = [
      {
        nodeId: "active",
        title: "Active",
        description: null,
        link: null,
        childrenNodes: [],
      },
    ];

    await expect(
      editAIMindmap("Expand this branch", currentBranch, "active")
    ).resolves.toMatchObject({
      rawOutput: expect.any(String),
      mindmap: expect.any(Array),
    });
    expect(mocks.generateRoutedAIStructured).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "node-editing",
        prompt: expect.stringContaining("Selected nodeId: active"),
      })
    );
  });
});
