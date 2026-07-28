import { z } from "zod";

type GeneratedTreeNode = {
  title: string;
  description?: string;
  link?: string;
  children: GeneratedTreeNode[];
};

const generatedTreeNodeSchema: z.ZodType<GeneratedTreeNode> = z.lazy(() =>
  z.object({
    title: z.string().min(1),
    description: z.string().optional(),
    link: z.string().optional(),
    children: z.array(generatedTreeNodeSchema).max(3).default([]),
  })
);

const generatedMindmapSchema = z.object({
  name: z.string().min(1),
  nodes: z.array(generatedTreeNodeSchema).min(1).max(6),
});

const generatedNodeSuggestionsSchema = z.object({
  nodes: z.array(generatedTreeNodeSchema).min(1).max(3),
});

export {
  generatedMindmapSchema,
  generatedNodeSuggestionsSchema,
  type GeneratedTreeNode,
  generatedTreeNodeSchema,
};
