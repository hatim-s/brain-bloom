import type { Id } from "@/convex/_generated/dataModel";
import type { NodeSnapshot } from "@/convex/lib/nodeOps";

/** Client-safe projection returned by the P4 mindmap queries. */
type MindmapDB = {
  _id: Id<"mindmaps">;
  publicId: string;
  name: string;
  visibility: "private" | "shared";
  updatedAt: number;
  isOwner: boolean;
};

/** Stable node fields consumed by the canvas transform pipeline. */
type MindmapNodeProjection = NodeSnapshot;

export { type MindmapDB, type MindmapNodeProjection };
