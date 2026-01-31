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
