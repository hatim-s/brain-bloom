import { describe, expect, it } from "vitest";

import { flattenSuggestions } from "./ai-node-edit";

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
