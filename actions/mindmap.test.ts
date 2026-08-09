import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMindmapFromAI } from "./mindmap";

const mocks = vi.hoisted(() => ({
  fetchMutation: vi.fn(),
  generateRoutedAIStructured: vi.fn(),
  getFreshConvexAuthToken: vi.fn(),
}));

vi.mock("convex/nextjs", () => ({ fetchMutation: mocks.fetchMutation }));
vi.mock("@/lib/convex-server", () => ({
  getFreshConvexAuthToken: mocks.getFreshConvexAuthToken,
}));
vi.mock("@/lib/ai/executionRouter", () => ({
  generateRoutedAIStructured: mocks.generateRoutedAIStructured,
}));

describe("createMindmapFromAI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getFreshConvexAuthToken.mockResolvedValue("convex-token");
    mocks.fetchMutation.mockResolvedValue({
      mindmapId: "map-1",
      publicId: "sprig-map",
    });
    mocks.generateRoutedAIStructured.mockResolvedValue({
      rawOutput: '{"name":"Launch","nodes":[]}',
      output: { name: "Launch", nodes: [] },
    });
  });

  it("selects first-map generation through the shared request execution router", async () => {
    await expect(createMindmapFromAI("Plan a launch")).resolves.toMatchObject({
      ok: true,
      data: { mindmapId: "map-1", publicId: "sprig-map" },
    });
    expect(mocks.generateRoutedAIStructured).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "mind-map-generation",
        prompt: "Plan a launch",
      })
    );
    expect(mocks.fetchMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: "Launch" }),
      { token: "convex-token" }
    );
  });
});
