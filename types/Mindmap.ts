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
  id: number;
  name: string;
  created_at: string; // ISO 8601,
  owner_user_id: string; // UUID
  nodes: MindmapNodeDB[];
  edges: MindmapEdgeDB[];
};
