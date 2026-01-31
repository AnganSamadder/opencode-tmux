import { describe, it, expect } from 'bun:test';
import {
  computeColumnCount,
  distributeAgentsRoundRobin,
  groupAgentsByColumn,
} from '../layout';

describe('computeColumnCount', () => {
  it('returns 0 for 0 agents', () => {
    expect(computeColumnCount(0, 3)).toBe(0);
  });

  it('returns 0 for negative agents', () => {
    expect(computeColumnCount(-1, 3)).toBe(0);
  });

  it('throws for maxAgentsPerColumn <= 0', () => {
    expect(() => computeColumnCount(5, 0)).toThrow();
    expect(() => computeColumnCount(5, -1)).toThrow();
  });

  it('computes ceil(5/3) = 2 columns', () => {
    expect(computeColumnCount(5, 3)).toBe(2);
  });

  it('computes ceil(4/2) = 2 columns', () => {
    expect(computeColumnCount(4, 2)).toBe(2);
  });

  it('computes ceil(3/3) = 1 column', () => {
    expect(computeColumnCount(3, 3)).toBe(1);
  });

  it('computes ceil(6/3) = 2 columns', () => {
    expect(computeColumnCount(6, 3)).toBe(2);
  });

  it('computes ceil(7/3) = 3 columns', () => {
    expect(computeColumnCount(7, 3)).toBe(3);
  });
});

describe('distributeAgentsRoundRobin', () => {
  it('returns empty for 0 agents', () => {
    const result = distributeAgentsRoundRobin(0, 3);
    expect(result.numColumns).toBe(0);
    expect(result.columnAssignments).toEqual([]);
  });

  it('5 agents, maxPerColumn=3 => 2 columns with round-robin [0,1,0,1,0]', () => {
    const result = distributeAgentsRoundRobin(5, 3);
    expect(result.numColumns).toBe(2);
    expect(result.columnAssignments).toEqual([0, 1, 0, 1, 0]);
  });

  it('4 agents, maxPerColumn=2 => 2 columns with alternating [0,1,0,1]', () => {
    const result = distributeAgentsRoundRobin(4, 2);
    expect(result.numColumns).toBe(2);
    expect(result.columnAssignments).toEqual([0, 1, 0, 1]);
  });

  it('3 agents, maxPerColumn=3 => 1 column with all in column 0', () => {
    const result = distributeAgentsRoundRobin(3, 3);
    expect(result.numColumns).toBe(1);
    expect(result.columnAssignments).toEqual([0, 0, 0]);
  });

  it('6 agents, maxPerColumn=2 => 3 columns [0,1,2,0,1,2]', () => {
    const result = distributeAgentsRoundRobin(6, 2);
    expect(result.numColumns).toBe(3);
    expect(result.columnAssignments).toEqual([0, 1, 2, 0, 1, 2]);
  });

  it('1 agent, maxPerColumn=5 => 1 column [0]', () => {
    const result = distributeAgentsRoundRobin(1, 5);
    expect(result.numColumns).toBe(1);
    expect(result.columnAssignments).toEqual([0]);
  });
});

describe('groupAgentsByColumn', () => {
  it('returns empty array for empty input', () => {
    expect(groupAgentsByColumn([], 3)).toEqual([]);
  });

  it('groups 5 agents with maxPerColumn=3 into 2 columns', () => {
    const agents = ['a', 'b', 'c', 'd', 'e'];
    const result = groupAgentsByColumn(agents, 3);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(['a', 'c', 'e']);
    expect(result[1]).toEqual(['b', 'd']);
  });

  it('groups 4 agents with maxPerColumn=2 into 2 balanced columns', () => {
    const agents = ['a', 'b', 'c', 'd'];
    const result = groupAgentsByColumn(agents, 2);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(['a', 'c']);
    expect(result[1]).toEqual(['b', 'd']);
  });

  it('groups 6 agents with maxPerColumn=2 into 3 columns', () => {
    const agents = ['a', 'b', 'c', 'd', 'e', 'f'];
    const result = groupAgentsByColumn(agents, 2);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual(['a', 'd']);
    expect(result[1]).toEqual(['b', 'e']);
    expect(result[2]).toEqual(['c', 'f']);
  });

  it('works with typed identifiers', () => {
    const agents = [1, 2, 3, 4, 5];
    const result = groupAgentsByColumn(agents, 3);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual([1, 3, 5]);
    expect(result[1]).toEqual([2, 4]);
  });
});
