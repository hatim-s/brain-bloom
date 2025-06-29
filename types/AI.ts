export type AIMindmap = {
  nodeId: string;
  title: string;
  description: string | null;
  link: string | null;
  childrenNodes?: string[];
};
