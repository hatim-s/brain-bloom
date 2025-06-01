import { graphlib, layout } from "@dagrejs/dagre";
import { Edge, Node } from "@xyflow/react";

const GRAPHLIB_CONFIG = {
  directed: true,
  compound: true, // Optional: for nested nodes
  multigraph: false,
};

const RANK_SEP = 100;
const NODE_SEP = 100;

const NODE_DIMENSIONS = {
  height: 30,
  width: 300,
};

function edgeLabelRenderer() {
  return {};
}

export function initLayout(initialNodes: Node[], initialEdges: Edge[]) {
  // Initialize the graph with rank settings
  const leftGraph = new graphlib.Graph(GRAPHLIB_CONFIG);
  const rightGraph = new graphlib.Graph(GRAPHLIB_CONFIG);

  // Set rank direction and spacing
  leftGraph.setGraph({
    rankdir: "RL", // Left-to-right layout
    ranksep: RANK_SEP, // 100px between ranks
    nodesep: NODE_SEP, // 30px between nodes in the same rank
  });

  rightGraph.setGraph({
    rankdir: "LR", // Left-to-right layout
    ranksep: RANK_SEP, // 100px between ranks
    nodesep: NODE_SEP, // 30px between nodes in the same rank
  });

  // Default to assigning a new object as a label for each new edge.
  leftGraph.setDefaultEdgeLabel(edgeLabelRenderer);
  rightGraph.setDefaultEdgeLabel(edgeLabelRenderer);

  // Add nodes to the graph. The first argument is the node id. The second is
  // metadata about the node. In this case we're going to add labels to each of
  // our nodes.
  initialNodes.forEach((node) => {
    if (node.type === "left") {
      leftGraph.setNode(node.id, {
        ...node.data,
        height: NODE_DIMENSIONS.height,
        width: NODE_DIMENSIONS.width,
      });
    } else if (node.type === "right") {
      rightGraph.setNode(node.id, {
        ...node.data,
        height: NODE_DIMENSIONS.height,
        width: NODE_DIMENSIONS.width,
      });
    } else if (node.type === "root") {
      // we want to set the root nodes to the center of the graph
      leftGraph.setNode(node.id, {
        ...node.data,
        height: NODE_DIMENSIONS.height,
        width: NODE_DIMENSIONS.width,
        x: 0,
        y: 0,
      });
      rightGraph.setNode(node.id, {
        ...node.data,
        height: NODE_DIMENSIONS.height,
        width: NODE_DIMENSIONS.width,
        x: 0,
        y: 0,
      });
    }
  });

  // Add edges to the graph.
  initialEdges.forEach((edge) => {
    if (edge.source === "root") {
      if (edge.target.startsWith("left")) {
        leftGraph.setEdge(edge.source, edge.target);
      } else {
        rightGraph.setEdge(edge.source, edge.target);
      }
    }
  });

  layout(leftGraph); // Assigns ranks and positions
  layout(rightGraph); // Assigns ranks and positions

  const leftGraphTranlations = {
    x: -leftGraph.node("root").x,
    y: -leftGraph.node("root").y,
  };

  const rightGraphTranlations = {
    x: -rightGraph.node("root").x,
    y: -rightGraph.node("root").y,
  };

  const initialNodesWithPositions = initialNodes.map((node) => {
    if (node.id === "root") {
      return {
        ...node,
        position: { x: 0, y: 0 },
      };
    }
    const nodeWithPosition =
      node.type === "left" ? leftGraph.node(node.id) : rightGraph.node(node.id);

    const translation =
      node.type === "left" ? leftGraphTranlations : rightGraphTranlations;

    return {
      ...node,
      position: {
        x: nodeWithPosition.x + translation.x,
        y: nodeWithPosition.y + translation.y,
      },
    };
  });

  return initialNodesWithPositions;
}
