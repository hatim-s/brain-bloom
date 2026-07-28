import { describe, expect, it } from "vitest";

import {
  DEFAULT_MAX_CHARACTERS,
  type SerializableMindmap,
  serializeMindmap,
  TRUNCATION_MARKER,
} from "./serializeMindmap";

const smallMindmap: SerializableMindmap = {
  mindmap: { name: "Launch plan" },
  nodes: [
    {
      nodeId: "root",
      parentId: null,
      title: "Launch plan",
      description: "Ship with confidence",
      order: 0,
    },
    {
      nodeId: "l-research",
      parentId: "root",
      title: "Research",
      order: 0,
    },
  ],
};

describe("serializeMindmap", () => {
  it("leaves a small depth-first outline unchanged", () => {
    expect(serializeMindmap(smallMindmap)).toBe(
      [
        "Mindmap: Launch plan",
        "- Launch plan [nodeId:root] — Ship with confidence",
        "  - Research [nodeId:l-research]",
      ].join("\n")
    );
  });

  it("respects the heuristic cap and adds an explicit truncation marker", () => {
    const maxCharacters = 96;
    const largeMindmap: SerializableMindmap = {
      mindmap: { name: "Large map" },
      nodes: [
        {
          nodeId: "root",
          parentId: null,
          title: "A very detailed root node with substantial context",
          description:
            "A long description that forces the serialized outline over its cap.",
          order: 0,
        },
        ...Array.from({ length: 8 }, (_, index) => ({
          nodeId: `r-${index}`,
          parentId: "root",
          title: `Detailed child number ${index}`,
          description: "More context that should be truncated depth-first.",
          order: index,
        })),
      ],
    };

    const outline = serializeMindmap(largeMindmap, { maxCharacters });

    expect(outline.length).toBeLessThanOrEqual(maxCharacters);
    expect(outline).toContain(TRUNCATION_MARKER);
  });

  it("produces the same small outline when given a larger explicit cap", () => {
    expect(
      serializeMindmap(smallMindmap, {
        maxCharacters: DEFAULT_MAX_CHARACTERS,
      })
    ).toBe(serializeMindmap(smallMindmap));
  });
});
