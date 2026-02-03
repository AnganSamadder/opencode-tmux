/**
 * Pure functions for computing agent column distribution.
 *
 * Agents are distributed round-robin across columns to balance panes evenly,
 * respecting the max_agents_per_column limit.
 */

/**
 * Represents the distribution of agents across columns.
 */
export interface ColumnDistribution {
  /** Number of columns needed to fit all agents */
  numColumns: number;
  /** Maps agent index -> column index (0-based) */
  columnAssignments: number[];
}

/**
 * Computes how many columns are needed to fit all agents given the per-column limit.
 *
 * Formula: Math.ceil(totalAgents / maxAgentsPerColumn)
 *
 * @param totalAgents - Number of agents to distribute
 * @param maxAgentsPerColumn - Maximum agents allowed per column
 * @returns Number of columns needed (0 if totalAgents is 0)
 */
export function computeColumnCount(
  totalAgents: number,
  maxAgentsPerColumn: number,
): number {
  if (totalAgents <= 0) {
    return 0;
  }
  if (maxAgentsPerColumn <= 0) {
    throw new Error('maxAgentsPerColumn must be positive');
  }
  return Math.ceil(totalAgents / maxAgentsPerColumn);
}

/**
 * Distributes agents round-robin across columns.
 *
 * Each agent at index i is assigned to column: i % numColumns
 *
 * This ensures even distribution - e.g., with 5 agents and 2 columns:
 * - Agent 0 -> Column 0
 * - Agent 1 -> Column 1
 * - Agent 2 -> Column 0
 * - Agent 3 -> Column 1
 * - Agent 4 -> Column 0
 *
 * Result: Column 0 has 3 agents, Column 1 has 2 agents.
 *
 * @param agentCount - Number of agents to distribute
 * @param maxAgentsPerColumn - Maximum agents allowed per column
 * @returns ColumnDistribution with numColumns and columnAssignments array
 */
export function distributeAgentsRoundRobin(
  agentCount: number,
  maxAgentsPerColumn: number,
): ColumnDistribution {
  const numColumns = computeColumnCount(agentCount, maxAgentsPerColumn);

  if (numColumns === 0) {
    return { numColumns: 0, columnAssignments: [] };
  }

  const columnAssignments: number[] = [];
  for (let i = 0; i < agentCount; i++) {
    columnAssignments.push(i % numColumns);
  }

  return { numColumns, columnAssignments };
}

/**
 * Gets agents grouped by column for layout purposes.
 *
 * @param agentIds - Array of agent identifiers
 * @param maxAgentsPerColumn - Maximum agents allowed per column
 * @returns Array of columns, each containing agent IDs in that column
 */
export function groupAgentsByColumn<T>(
  agentIds: T[],
  maxAgentsPerColumn: number,
): T[][] {
  const { numColumns, columnAssignments } = distributeAgentsRoundRobin(
    agentIds.length,
    maxAgentsPerColumn,
  );

  if (numColumns === 0) {
    return [];
  }

  const columns: T[][] = Array.from({ length: numColumns }, () => []);

  for (let i = 0; i < agentIds.length; i++) {
    const columnIndex = columnAssignments[i];
    columns[columnIndex].push(agentIds[i]);
  }

  return columns;
}

type LayoutType = 'LEFTRIGHT' | 'TOPBOTTOM' | 'WINDOWPANE';

interface LayoutCell {
  type: LayoutType;
  sx: number;
  sy: number;
  xoff: number;
  yoff: number;
  wpId?: number;
  children?: LayoutCell[];
}

export function mainPanePercentForColumns(numColumns: number): number {
  if (numColumns <= 1) return 60;
  if (numColumns === 2) return 45;
  return 30;
}

export function layoutChecksum(layout: string): number {
  let csum = 0;
  for (let i = 0; i < layout.length; i++) {
    csum = (csum >> 1) + ((csum & 1) << 15);
    csum = (csum + layout.charCodeAt(i)) & 0xffff;
  }
  return csum;
}

function dumpLayoutCell(cell: LayoutCell): string {
  const base =
    cell.wpId !== undefined
      ? `${cell.sx}x${cell.sy},${cell.xoff},${cell.yoff},${cell.wpId}`
      : `${cell.sx}x${cell.sy},${cell.xoff},${cell.yoff}`;

  if (cell.type === 'WINDOWPANE') {
    return base;
  }

  const children = cell.children ?? [];
  const open = cell.type === 'LEFTRIGHT' ? '{' : '[';
  const close = cell.type === 'LEFTRIGHT' ? '}' : ']';
  return `${base}${open}${children.map(dumpLayoutCell).join(',')}${close}`;
}

function splitSizes(total: number, count: number): number[] {
  if (count <= 0) return [];
  const separators = count - 1;
  const available = Math.max(0, total - separators);
  const base = Math.floor(available / count);
  const remainder = available - base * count;

  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    out.push(base + (i < remainder ? 1 : 0));
  }
  return out;
}

export function buildMainVerticalMultiColumnLayoutString(params: {
  windowWidth: number;
  windowHeight: number;
  mainPaneWpId: number;
  columns: number[][];
  mainPanePercent: number;
}): string {
  const { windowWidth, windowHeight, mainPaneWpId, columns, mainPanePercent } = params;

  const numColumns = columns.length;
  if (numColumns <= 0) {
    throw new Error('columns must be non-empty');
  }

  const clampedPercent = Math.max(30, Math.min(80, mainPanePercent));
  const desiredMainWidth = Math.floor((windowWidth * clampedPercent) / 100);
  const mainWidth = Math.max(0, Math.min(windowWidth - 2, desiredMainWidth));
  const rightWidth = Math.max(0, windowWidth - mainWidth - 1);

  const mainCell: LayoutCell = {
    type: 'WINDOWPANE',
    sx: mainWidth,
    sy: windowHeight,
    xoff: 0,
    yoff: 0,
    wpId: mainPaneWpId,
  };

  const rightXoff = mainWidth + 1;
  const colWidths = splitSizes(rightWidth, numColumns);
  const columnCells: LayoutCell[] = [];

  let xoff = rightXoff;
  for (let c = 0; c < numColumns; c++) {
    const colPaneIds = columns[c];
    const colWidth = colWidths[c] ?? 0;

    if (colPaneIds.length === 1) {
      columnCells.push({
        type: 'WINDOWPANE',
        sx: colWidth,
        sy: windowHeight,
        xoff,
        yoff: 0,
        wpId: colPaneIds[0],
      });
    } else {
      const rowHeights = splitSizes(windowHeight, colPaneIds.length);
      const rows: LayoutCell[] = [];
      let yoff = 0;
      for (let r = 0; r < colPaneIds.length; r++) {
        rows.push({
          type: 'WINDOWPANE',
          sx: colWidth,
          sy: rowHeights[r] ?? 0,
          xoff,
          yoff,
          wpId: colPaneIds[r],
        });
        yoff += (rowHeights[r] ?? 0) + 1;
      }

      columnCells.push({
        type: 'TOPBOTTOM',
        sx: colWidth,
        sy: windowHeight,
        xoff,
        yoff: 0,
        children: rows,
      });
    }

    xoff += colWidth + 1;
  }

  const rightCell: LayoutCell =
    numColumns === 1
      ? (columnCells[0] as LayoutCell)
      : {
          type: 'LEFTRIGHT',
          sx: rightWidth,
          sy: windowHeight,
          xoff: rightXoff,
          yoff: 0,
          children: columnCells,
        };

  const root: LayoutCell = {
    type: 'LEFTRIGHT',
    sx: windowWidth,
    sy: windowHeight,
    xoff: 0,
    yoff: 0,
    children: [mainCell, rightCell],
  };

  const layout = dumpLayoutCell(root);
  const checksum = layoutChecksum(layout);
  return `${checksum.toString(16).padStart(4, '0')},${layout}`;
}
