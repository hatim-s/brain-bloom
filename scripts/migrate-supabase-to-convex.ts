import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

import type { NodeSnapshot } from "../convex/lib/nodeOps.ts";

/**
 * Exact legacy row stored by Supabase: each row owns XYFlow node and edge JSON
 * arrays rather than normalized node records. Older rows use numeric `id` URLs;
 * an optional `public_id` is accepted for partially migrated datasets.
 */
type LegacyMindmapRow = {
  id: number;
  name: string;
  created_at: string;
  owner_user_id: string;
  public_id?: string | null;
  nodes: LegacyFlowNode[] | null;
  edges: LegacyFlowEdge[] | null;
};

type LegacyFlowNode = {
  id: string;
  type: "root" | "left" | "right";
  data: {
    title: string;
    description?: string;
    link?: string;
  };
};

type LegacyFlowEdge = {
  id: string;
  source: string;
  target: string;
};

type MigrationPayload = {
  mindmap: { name: string; publicId?: string };
  nodes: NodeSnapshot[];
};

type ImportSummary = {
  status: "created" | "updated" | "unchanged";
  added: number;
  changed: number;
  removed: number;
};

type CliOptions = {
  execute: boolean;
  owner?: string;
};

/** Converts one legacy XYFlow graph into deterministic normalized snapshots. */
function transformLegacyMindmap(row: LegacyMindmapRow): MigrationPayload {
  const legacyNodes = row.nodes ?? [];
  const legacyEdges = row.edges ?? [];
  const nodesById = new Map(
    legacyNodes.map((node) => [node.id, node] as const)
  );
  const roots = legacyNodes.filter((node) => node.type === "root");

  if (roots.length !== 1) {
    throw new Error(`Mindmap ${row.id} must contain exactly one root node`);
  }

  const childrenByParent = new Map<string, LegacyFlowNode[]>();
  for (const edge of legacyEdges) {
    const child = nodesById.get(edge.target);
    if (!nodesById.has(edge.source) || !child) {
      throw new Error(`Mindmap ${row.id} contains a dangling edge ${edge.id}`);
    }

    const siblings = childrenByParent.get(edge.source) ?? [];
    siblings.push(child);
    childrenByParent.set(edge.source, siblings);
  }

  const snapshots: NodeSnapshot[] = [];
  const visited = new Set<string>();

  /** Walks the stored edge order to assign stable parent and sibling order. */
  const visit = (
    node: LegacyFlowNode,
    parentId: string | null,
    order: number
  ) => {
    if (visited.has(node.id)) {
      throw new Error(`Mindmap ${row.id} contains a cycle at ${node.id}`);
    }
    visited.add(node.id);
    snapshots.push({
      nodeId: node.id,
      parentId,
      type: node.type,
      title: node.data.title,
      ...(node.data.description === undefined
        ? {}
        : { description: node.data.description }),
      ...(node.data.link === undefined ? {} : { link: node.data.link }),
      order,
    });

    (childrenByParent.get(node.id) ?? []).forEach((child, childOrder) => {
      visit(child, node.id, childOrder);
    });
  };

  visit(roots[0], null, 0);
  if (visited.size !== legacyNodes.length) {
    throw new Error(`Mindmap ${row.id} contains unreachable nodes`);
  }

  return {
    mindmap: {
      name: row.name,
      // Preserve old numeric URLs when no staged public id exists.
      publicId: row.public_id ?? String(row.id),
    },
    nodes: snapshots,
  };
}

/** Parses the dry-run-by-default command line without external dependencies. */
function parseCliOptions(argv: string[]): CliOptions {
  const options: CliOptions = { execute: false };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--execute") {
      options.execute = true;
    } else if (argument === "--dry-run") {
      options.execute = false;
    } else if (argument === "--owner") {
      const owner = argv[index + 1];
      if (!owner || owner.startsWith("--")) {
        throw new Error("--owner requires a Clerk subject");
      }
      options.owner = owner;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (options.execute && !options.owner) {
    throw new Error("--owner <Clerk subject> is required with --execute");
  }

  return options;
}

/** Fetches every legacy JSON row through PostgREST without Supabase packages. */
async function fetchLegacyMindmaps(): Promise<LegacyMindmapRow[]> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const apiKey = process.env.SUPABASE_API_KEY;

  if (!supabaseUrl || !apiKey) {
    throw new Error("SUPABASE_URL and SUPABASE_API_KEY are required");
  }

  const response = await fetch(`${supabaseUrl}/rest/v1/mindmaps?select=*`, {
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    throw new Error(
      `Supabase REST request failed: ${response.status} ${await response.text()}`
    );
  }

  return (await response.json()) as LegacyMindmapRow[];
}

/** Runs one internal Convex function through the administrator CLI. */
async function runConvexFunction(
  functionName: string,
  args: Record<string, unknown>
): Promise<ImportSummary> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "npx",
      ["convex", "run", functionName, JSON.stringify(args)],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `convex run exited with ${code}`));
        return;
      }

      try {
        resolve(JSON.parse(stdout.trim()) as ImportSummary);
      } catch {
        reject(new Error(`Could not parse Convex output: ${stdout.trim()}`));
      }
    });
  });
}

/** Migrates or previews every legacy mindmap and prints its node diff. */
async function main(argv = process.argv.slice(2)): Promise<void> {
  const options = parseCliOptions(argv);
  const rows = await fetchLegacyMindmaps();

  for (const row of rows) {
    const transformed = transformLegacyMindmap(row);
    const publicId = transformed.mindmap.publicId ?? String(row.id);
    const ownerId = options.owner ?? row.owner_user_id;
    const functionName = options.execute
      ? "migration:importMindmap"
      : "migration:previewMindmapImport";
    const summary = await runConvexFunction(functionName, {
      ownerId,
      name: transformed.mindmap.name,
      publicId,
      nodes: transformed.nodes,
    });

    // eslint-disable-next-line no-console -- CLI output is the migration report.
    console.log(
      `${options.execute ? "execute" : "dry-run"} ${publicId} (${row.name}): ` +
        `${summary.status}; +${summary.added} ~${summary.changed} -${summary.removed}`
    );
  }
}

const importMeta = import.meta as ImportMeta & { main?: boolean };
const invokedPath = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : undefined;
const isMainModule = importMeta.main ?? import.meta.url === invokedPath;

if (isMainModule) {
  void main().catch((error: unknown) => {
    // eslint-disable-next-line no-console -- CLI failures must reach operators.
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

export {
  type CliOptions,
  type LegacyMindmapRow,
  main,
  type MigrationPayload,
  parseCliOptions,
  transformLegacyMindmap,
};
