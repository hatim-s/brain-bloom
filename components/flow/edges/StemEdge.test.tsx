// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StemEdge } from "./StemEdge";

// The stem only needs two things from xyflow: the measured card boxes and a
// place to put its path. Both are cheaper to stand in for than a whole provider.
// `vi.mock` is hoisted above the import above, so the stem never sees the real
// module.
vi.mock("@xyflow/react", () => ({
  BaseEdge: ({ path }: { path: string }) => (
    <path className="react-flow__edge-path" d={path} />
  ),
  useInternalNode: (id: string) =>
    id === "missing"
      ? undefined
      : {
          id,
          measured: { width: 300, height: 64 },
          internals: {
            positionAbsolute:
              id === "source" ? { x: 0, y: 0 } : { x: 600, y: 320 },
          },
        },
}));

afterEach(cleanup);

describe("StemEdge", () => {
  it("paints the underglow beneath the stem, on the same curve", () => {
    const view = renderStem();
    const paths = Array.from(view.container.querySelectorAll("path"));

    expect(paths).toHaveLength(2);
    // Painting order is the layering: the halo has to be drawn first.
    expect(paths[0].getAttribute("class")).toBe("sprig-stem-underglow");
    expect(paths[1].getAttribute("class")).toBe("react-flow__edge-path");
    // A halo that traced a different curve would read as a second stem.
    expect(paths[0].getAttribute("d")).toBe(paths[1].getAttribute("d"));
    expect(paths[0].getAttribute("d")).toContain("C ");
  });

  it("renders nothing when a card has not been measured yet", () => {
    const view = render(
      <svg>
        <StemEdge {...EDGE_PROPS} source="missing" />
      </svg>
    );

    expect(view.container.querySelectorAll("path")).toHaveLength(0);
  });
});

/** Renders one stem between two measured cards. */
function renderStem() {
  return render(
    <svg>
      <StemEdge {...EDGE_PROPS} />
    </svg>
  );
}

const EDGE_PROPS = {
  id: "e@source@target",
  source: "source",
  target: "target",
} as unknown as Parameters<typeof StemEdge>[0];
