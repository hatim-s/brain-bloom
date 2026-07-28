const DEFAULT_MAX_TOKENS = 6_000;
const CHARACTERS_PER_TOKEN = 4;
const TRUNCATION_MARKER = "(truncated)";

type SerializableMindmapNode = {
  nodeId: string;
  parentId: string | null;
  title: string;
  description?: string;
  link?: string;
  order: number;
};

type SerializableMindmap = {
  mindmap: {
    name: string;
  };
  nodes: SerializableMindmapNode[];
};

type SerializeMindmapOptions = {
  maxTokens?: number;
};

/** Collapses whitespace so each outline row stays compact and prompt-safe. */
function compactText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Formats one node with its stable id marker and optional supporting fields. */
function formatNode(node: SerializableMindmapNode, depth: number): string {
  const details = [
    node.description ? compactText(node.description) : undefined,
    node.link ? compactText(node.link) : undefined,
  ].filter((value): value is string => value !== undefined && value.length > 0);
  const suffix = details.length > 0 ? ` — ${details.join(" | ")}` : "";

  return `${"  ".repeat(depth)}- ${compactText(node.title)} [nodeId:${node.nodeId}]${suffix}`;
}

/**
 * Serializes a mindmap into a depth-first outline capped by the four
 * characters-per-token heuristic used by the chat prompt.
 */
function serializeMindmap(
  value: SerializableMindmap,
  options: SerializeMindmapOptions = {}
): string {
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  const maxCharacters = Math.max(
    TRUNCATION_MARKER.length,
    Math.floor(maxTokens * CHARACTERS_PER_TOKEN)
  );
  const childrenByParent = new Map<string | null, SerializableMindmapNode[]>();

  for (const node of value.nodes) {
    const siblings = childrenByParent.get(node.parentId) ?? [];
    siblings.push(node);
    childrenByParent.set(node.parentId, siblings);
  }

  childrenByParent.forEach((siblings) => {
    siblings.sort(
      (left, right) =>
        left.order - right.order || left.nodeId.localeCompare(right.nodeId)
    );
  });

  const lines = [`Mindmap: ${compactText(value.mindmap.name)}`];
  const visited = new Set<string>();

  /** Walks the persisted tree without hanging on malformed cyclic data. */
  function visit(node: SerializableMindmapNode, depth: number): void {
    if (visited.has(node.nodeId)) {
      return;
    }

    visited.add(node.nodeId);
    lines.push(formatNode(node, depth));

    for (const child of childrenByParent.get(node.nodeId) ?? []) {
      visit(child, depth + 1);
    }
  }

  for (const root of childrenByParent.get(null) ?? []) {
    visit(root, 0);
  }

  // Preserve otherwise-unreachable records as top-level rows for debugging.
  for (const node of value.nodes) {
    if (!visited.has(node.nodeId)) {
      visit(node, 0);
    }
  }

  const completeOutline = lines.join("\n");
  if (completeOutline.length <= maxCharacters) {
    return completeOutline;
  }

  const prefixBudget = maxCharacters - TRUNCATION_MARKER.length - 1;
  const includedLines: string[] = [];

  for (const line of lines) {
    const candidate = [...includedLines, line].join("\n");
    if (candidate.length > prefixBudget) {
      break;
    }

    includedLines.push(line);
  }

  // If even the first row exceeds the cap, retain its leading context.
  const prefix =
    includedLines.length > 0
      ? includedLines.join("\n")
      : completeOutline.slice(0, Math.max(0, prefixBudget)).replace(/\s+$/, "");

  return prefix.length > 0
    ? `${prefix}\n${TRUNCATION_MARKER}`
    : TRUNCATION_MARKER;
}

export {
  CHARACTERS_PER_TOKEN,
  DEFAULT_MAX_TOKENS,
  type SerializableMindmap,
  type SerializableMindmapNode,
  serializeMindmap,
  type SerializeMindmapOptions,
  TRUNCATION_MARKER,
};
