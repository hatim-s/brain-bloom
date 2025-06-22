export type MindmapNodeDB = {
  id: string;
  type: "root" | "left" | "right";
  data: {
    title: string;
    description?: string;
    link?: string;
  };
};

export type MindmapEdgeDB = {
  id: string;
  source: string;
  target: string;
};

export type MindmapDB = {
  id: string;
  name: string;
  created_at: string; // ISO 8601,
  nodes: MindmapNodeDB[];
  edges: MindmapEdgeDB[];
};
