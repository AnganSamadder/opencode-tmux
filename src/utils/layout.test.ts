import { describe, test, expect } from 'bun:test';
import { generateLayoutString } from './layout';

describe('generateLayoutString', () => {
  const defaultParams = {
    width: 200,
    height: 50,
    mainPaneSizePercent: 70,
    mainPaneId: 'main',
  };

  test('3 agents, limit 3 (should be 1 col)', () => {
    const params = {
      ...defaultParams,
      paneIds: ['p1', 'p2', 'p3'],
      maxAgentsPerColumn: 3,
    };

    const layout = generateLayoutString(params);
    
    // Should be a vertical split of 3 panes: [...,p1,...,p2,...,p3]
    // We expect exactly one '[' in the entire layout
    expect(countOccurrences(layout, '[')).toBe(1);
    
    // Check if the vertical split contains 3 panes
    const match = layout.match(/\[([^\]]+)\]/);
    expect(match).not.toBeNull();
    const panes = match![1].split(',');
    // Each pane is WxH,X,Y,id. So 3 panes will have 3 * 4 - 1 = 11 commas if we split by everything.
    // Better: count occurrences of 'p' or the actual IDs
    expect(panes.filter(p => p.includes('p')).length).toBe(3);
  });

  test('4 agents, limit 3 (should be 2 cols: 3, 1)', () => {
    const params = {
      ...defaultParams,
      paneIds: ['p1', 'p2', 'p3', 'p4'],
      maxAgentsPerColumn: 3,
    };

    const layout = generateLayoutString(params);
    
    // GREEDY (Desired): Col 1 (3 agents), Col 2 (1 agent)
    // There should be exactly one '[' (for the first column)
    // The second column will be a leaf node (no brackets)
    
    // Since we haven't implemented the fix, it currently produces Balanced:
    // 2 columns, each with 2 agents -> [[...], [...]]
    // So there will be TWO '['.
    
    expect(countOccurrences(layout, '[')).toBe(1);
    
    // Check the 3-pane column
    const vSplitMatch = layout.match(/\[([^\]]+)\]/);
    expect(vSplitMatch).not.toBeNull();
    const vPanes = vSplitMatch![1].split(',').filter(p => p.includes('p'));
    expect(vPanes.length).toBe(3);
    
    // Check that p4 is outside the vertical split
    expect(layout).toMatch(/,p4/);
    const splitIndex = layout.indexOf('[');
    const p4Index = layout.indexOf(',p4');
    const splitEndIndex = layout.lastIndexOf(']');
    expect(p4Index).toBeGreaterThan(splitEndIndex);
  });
});

function countOccurrences(str: string, char: string): number {
  return str.split(char).length - 1;
}
