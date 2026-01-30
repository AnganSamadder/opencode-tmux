export interface LayoutParams {
  width: number;
  height: number;
  mainPaneSizePercent: number;
  paneIds: string[]; // List of subagent pane IDs (does not include main pane)
  mainPaneId: string;
  maxAgentsPerColumn: number;
}

export function generateLayoutString(params: LayoutParams): string {
  const { width, height, mainPaneSizePercent, paneIds, mainPaneId, maxAgentsPerColumn } = params;

  // Safety filter to remove mainPaneId if present in paneIds
  const cleanPaneIds = paneIds.filter(id => id !== mainPaneId);

  // Safety check
  if (width <= 0 || height <= 0) {
    return ``; // Invalid dimensions
  }

  // Calculate Main Pane Width
  // Tmux main-vertical style: Main pane is on the left
  const mainPaneWidth = Math.floor((width * mainPaneSizePercent) / 100);
  const subagentAreaWidth = width - mainPaneWidth;

  // Build the tree structure
  // Root is a Left-Right split (assuming we have subagents)
  // If no subagents, only the main pane is rendered.
  
  if (cleanPaneIds.length === 0) {
    // Just main pane
    const layout = formatNode(width, height, 0, 0, mainPaneId);
    return withChecksum(layout);
  }

  // Root Node: Container { MainPane, SubagentArea }
  // Layout format: WxH,X,Y{Node1,Node2}
  
  // 1. Main Pane Node
  const mainNode = formatNode(mainPaneWidth, height, 0, 0, mainPaneId);

  // 2. Subagent Area Node
  // This area is split into Columns (Left-Right)
  const numSubagents = cleanPaneIds.length;
  // If maxAgentsPerColumn is 0, we treat it as "infinity" (single column)
  const limit = maxAgentsPerColumn > 0 ? maxAgentsPerColumn : numSubagents;
  const numCols = Math.ceil(numSubagents / limit);
  
  // Distribute agents to columns as evenly as possible.
  const colWidth = Math.floor(subagentAreaWidth / numCols);
  // Last column takes remainder to avoid pixel rounding gaps
  
  const columns: string[] = [];
  let currentX = mainPaneWidth;
  let remainingAgents = numSubagents;
  let agentsProcessed = 0;

  for (let c = 0; c < numCols; c++) {
    const isLastCol = c === numCols - 1;
    const thisColWidth = isLastCol ? (width - currentX) : colWidth;
    
    // Determine how many agents in this column
    // We have 'remainingAgents' to distribute into 'numCols - c' columns.
    // e.g. 5 agents, 2 cols. 
    // Col 0: ceil(5/2) = 3. Remaining = 2.
    // Col 1: ceil(2/1) = 2.
    const agentsInThisCol = Math.min(remainingAgents, limit);
    remainingAgents -= agentsInThisCol;

    const colPaneIds = cleanPaneIds.slice(agentsProcessed, agentsProcessed + agentsInThisCol);
    agentsProcessed += agentsInThisCol;

    // Build Column Node (Top-Bottom split of panes)
    const colNode = buildColumn(thisColWidth, height, currentX, 0, colPaneIds);
    columns.push(colNode);

    currentX += thisColWidth;
  }

  // Combine Columns into Subagent Area
  // If 1 column, it is the node.
  // If > 1 column, it's a LR split of columns.
  let subagentAreaNode: string;
  if (columns.length === 1) {
    subagentAreaNode = columns[0];
  } else {
    // Columns are children of the subagent area
    // The subagent area itself is WxH,X,Y{Col1,Col2...}
    subagentAreaNode = `${subagentAreaWidth}x${height},${mainPaneWidth},0{${columns.join(',')}}`;
  }

  // Root: { MainNode, SubagentAreaNode }
  const rootLayout = `${width}x${height},0,0{${mainNode},${subagentAreaNode}}`;
  
  return withChecksum(rootLayout);
}

function buildColumn(width: number, height: number, x: number, y: number, paneIds: string[]): string {
  if (paneIds.length === 0) return ''; // Should not happen
  if (paneIds.length === 1) {
    return formatNode(width, height, x, y, paneIds[0]);
  }

  // Split Vertically (Top-Bottom)
  const rowHeight = Math.floor(height / paneIds.length);
  const nodes: string[] = [];
  let currentY = y;

  for (let i = 0; i < paneIds.length; i++) {
    const isLast = i === paneIds.length - 1;
    const thisRowHeight = isLast ? (height - (currentY - y)) : rowHeight;
    
    nodes.push(formatNode(width, thisRowHeight, x, currentY, paneIds[i]));
    currentY += thisRowHeight;
  }

  // Tmux uses [] for vertical splits
  return `${width}x${height},${x},${y}[${nodes.join(',')}]`;
}

function formatNode(w: number, h: number, x: number, y: number, id: string): string {
  return `${w}x${h},${x},${y},${id}`;
}

function withChecksum(layout: string): string {
  let csum = 0;
  for (let i = 0; i < layout.length; i++) {
      let byte = layout.charCodeAt(i);
      csum = (csum >> 1) + ((csum & 1) << 15);
      csum += byte;
  }
  csum = csum & 0xffff;
  return `${csum.toString(16).toLowerCase()},${layout}`;
}
