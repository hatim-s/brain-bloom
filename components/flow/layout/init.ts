import { graphlib, layout } from "@dagrejs/dagre";
import { Edge } from "@xyflow/react";

import { ROOT_NODE_ID } from "../const";
import { getNodeTypeFromId } from "../mindmap/createNode";
import { BaseFlowNode, FlowNode, NodeTypes } from "../types";

const GRAPHLIB_CONFIG = {
  directed: true,
  compound: true, // Optional: for nested nodes
  multigraph: false,
};

const RANK_SEP = 300;
const NODE_SEP = 50;

export const NODE_DIMENSIONS = {
  height: 60,
  width: 300,
};

export const ROOT_NODE_DIMENSIONS = {
  height: 120,
  width: 300,
};

function edgeLabelRenderer() {
  return {};
}

function calculateNodeHeight(node: BaseFlowNode): number {
  const baseHeight = 12 * 2; // top and bottom padding
  const titleHeight = 28; // text-xl height
  const descriptionHeight = 24 * 2; // text-base height, we only support 2 lines in view

  let height = baseHeight;

  height += titleHeight;

  // Add height for description if present
  if (node.data.description) {
    height += descriptionHeight;
  }

  return height;
}

/**
 * Initialize the graphs for the left and right sides of the mindmap.
 *
 * @description
 * The graphs are initialized with the following configuration:
 * - directed: true
 * - compound: true
 * - multigraph: false
 *
 * @returns {
 *  leftGraph: graphlib.Graph<object>,
 *  rightGraph: graphlib.Graph<object>,
 * }
 */
export function initGraphs() {
  const leftGraph = new graphlib.Graph(GRAPHLIB_CONFIG);
  const rightGraph = new graphlib.Graph(GRAPHLIB_CONFIG);

  // Set rank direction and spacing
  leftGraph.setGraph({
    rankdir: "RL", // Left-to-right layout
    ranksep: RANK_SEP, // 300px between ranks
    nodesep: NODE_SEP, // 30px between nodes in the same rank
  });

  rightGraph.setGraph({
    rankdir: "LR", // Left-to-right layout
    ranksep: RANK_SEP, // 300px between ranks
    nodesep: NODE_SEP, // 30px between nodes in the same rank
  });

  // Default to assigning a new object as a label for each new edge.
  leftGraph.setDefaultEdgeLabel(edgeLabelRenderer);
  rightGraph.setDefaultEdgeLabel(edgeLabelRenderer);

  return { leftGraph, rightGraph };
}

/**
 * Initialize the layout for the left and right sides of the mindmap.
 *
 * @description
 * The function takes the graphs and initial nodes and edges, and adds them to the graphs.
 * It then layouts the graphs and assigns ranks, levels andpositions to the nodes.
 * It then returns the initial nodes with positions.
 *
 * @param graphs - The graphs to initialize the layout for.
 * @param initialNodes - The initial nodes to add to the graphs.
 * @param initialEdges - The initial edges to add to the graphs.
 * @returns The initial nodes with positions.
 */
export function initLayout(
  graphs: { leftGraph: graphlib.Graph; rightGraph: graphlib.Graph },
  initialNodes: BaseFlowNode[],
  initialEdges: Edge[]
): FlowNode[] {
  const { leftGraph, rightGraph } = graphs;

  // Add nodes to the graph. The first argument is the node id. The second is
  // metadata about the node. In this case we're going to add labels to each of
  // our nodes.
  initialNodes.forEach((node) => {
    const dimensions = getNodeDimensions(node);
    if (node.type === NodeTypes.LEFT) {
      leftGraph.setNode(node.id, {
        // ...node.data,
        height: dimensions.height,
        width: dimensions.width,
      });
    } else if (node.type === NodeTypes.RIGHT) {
      rightGraph.setNode(node.id, {
        // ...node.data,
        height: dimensions.height,
        width: dimensions.width,
      });
    } else if (node.type === NodeTypes.ROOT) {
      leftGraph.setNode(node.id, {
        // ...node.data,
        height: dimensions.height,
        width: dimensions.width,
        x: 0,
        y: 0,
      });
      rightGraph.setNode(node.id, {
        // ...node.data,
        height: dimensions.height,
        width: dimensions.width,
        x: 0,
        y: 0,
      });
    }
  });

  // Add edges to the graph.
  initialEdges.forEach((edge) => {
    if (getNodeTypeFromId(edge.target) === NodeTypes.LEFT) {
      leftGraph.setEdge(edge.source, edge.target);
    } else {
      rightGraph.setEdge(edge.source, edge.target);
    }
  });

  layout(leftGraph); // Assigns ranks and positions
  layout(rightGraph); // Assigns ranks and positions

  const leftGraphTranlations = {
    x: -leftGraph.node(ROOT_NODE_ID).x,
    y: -leftGraph.node(ROOT_NODE_ID).y,
  };

  const rightGraphTranlations = {
    x: -rightGraph.node(ROOT_NODE_ID).x,
    y: -rightGraph.node(ROOT_NODE_ID).y,
  };

  const initialNodesWithPositions = initialNodes.map((node) => {
    if (node.id === ROOT_NODE_ID) {
      return {
        ...node,
        position: { x: 0, y: 0 },
      };
    }
    const nodeWithPosition =
      node.type === NodeTypes.LEFT
        ? leftGraph.node(node.id)
        : rightGraph.node(node.id);

    const translation =
      node.type === NodeTypes.LEFT
        ? leftGraphTranlations
        : rightGraphTranlations;

    return {
      ...node,
      position: {
        x: nodeWithPosition.x + translation.x,
        y: nodeWithPosition.y + translation.y,
      },
    };
  });

  return initialNodesWithPositions as FlowNode[];
}

/**
 * Add a node to the graph.
 *
 * @description
 * The function adds a node to the graph and assigns it a position.
 * It then layouts the graph.
 *
 * @param graph - The graph to add the node to.
 * @param node - The node to add to the graph.
 * @param edge - The edge to add to the graph.
 */
export function addNodeToGraph(
  graph: graphlib.Graph<object>,
  node: BaseFlowNode,
  edge: Edge
) {
  graph.setNode(node.id, {
    ...node.data,
    height: calculateNodeHeight(node),
    width: NODE_DIMENSIONS.width,
  });

  graph.setEdge(edge.source, edge.target);

  layout(graph);
}

export function getNodeDimensions(node: BaseFlowNode) {
  return {
    width: 300, // Fixed width based on UI design
    height: calculateNodeHeight(node),
  };
}
