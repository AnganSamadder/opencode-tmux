#!/usr/bin/env bun
import { execSync } from 'node:child_process';
import { generateLayoutString, type LayoutParams } from '../src/utils/layout';

const SESSION_NAME = `verify-layout-test-${Math.floor(Math.random() * 10000)}`;
const NUM_SUBAGENTS = 8;
const MAIN_PANE_PERCENT = 60;

function tmux(cmd: string): string {
  try {
    return execSync(`tmux ${cmd}`, { encoding: 'utf-8' }).trim();
  } catch (err: any) {
    console.error(`Error executing tmux ${cmd}:`, err.stderr || err.message);
    throw err;
  }
}

async function runVerification() {
  console.log(`Starting verification in session: ${SESSION_NAME}`);

  try {
    // 1. Create headless session with fixed large size to avoid constraints
    // Using -x and -y to set window size
    tmux(`new-session -d -s ${SESSION_NAME} -n main -x 200 -y 80 "sleep 100"`);
    
    // Get actual dimensions (sometimes tmux doesn't respect -x -y exactly if it's too small for term)
    const dimensions = tmux(`display-message -t ${SESSION_NAME}:main -p "#{window_width} #{window_height}"`).split(' ');
    const width = parseInt(dimensions[0]);
    const height = parseInt(dimensions[1]);
    console.log(`Window dimensions: ${width}x${height}`);

    // 2. Spawn dummy panes
    const mainPaneId = tmux(`display-message -t ${SESSION_NAME}:main -p "#{pane_id}"`).replace('%', '');
    const paneIds: string[] = [];
    
    for (let i = 0; i < NUM_SUBAGENTS; i++) {
      // Split horizontally and balance to ensure space for next split
      const newPaneId = tmux(`split-window -h -t ${SESSION_NAME}:main -d -P -F "#{pane_id}" "sleep 100"`).replace('%', '');
      paneIds.push(newPaneId);
      tmux(`select-layout -t ${SESSION_NAME}:main even-horizontal`);
    }

    console.log(`Main pane: %${mainPaneId}, Subagent panes: ${paneIds.map(id => `%${id}`).join(', ')}`);

    // 3. Generate layout
    const params: LayoutParams = {
      width,
      height,
      mainPaneSizePercent: MAIN_PANE_PERCENT,
      paneIds: paneIds.map(id => `%${id}`),
      mainPaneId: `%${mainPaneId}`,
      maxAgentsPerColumn: 3
    };

    const layoutString = generateLayoutString(params);
    console.log(`Generated layout string: ${layoutString}`);

    // 4. Apply layout
    // We use select-layout. Tmux is picky about layout strings matching the actual panes.
    tmux(`select-layout -t ${SESSION_NAME}:main "${layoutString}"`);

    // 5. Measure panes
    const listOutput = tmux(`list-panes -t ${SESSION_NAME}:main -F "#{pane_id} #{pane_width} #{pane_height} #{pane_left} #{pane_top}"`);
    const panesInfo = listOutput.split('\n')
      .map(line => {
        const parts = line.split(' ');
        return { 
            id: parts[0].replace('%', ''), 
            w: parseInt(parts[1]), 
            h: parseInt(parts[2]), 
            l: parseInt(parts[3]), 
            t: parseInt(parts[4]) 
        };
      });

    // 6. Assertions
    const mainPane = panesInfo.find(p => p.id === mainPaneId);
    if (!mainPane) throw new Error("Main pane not found in list-panes output");

    console.log(`Main Pane Dimensions: ${mainPane.w}x${mainPane.h} at (${mainPane.l},${mainPane.t})`);

    const expectedMainWidth = Math.floor((width * MAIN_PANE_PERCENT) / 100);
    const widthDiff = Math.abs(mainPane.w - expectedMainWidth);
    
    // Main pane width assertion
    if (widthDiff > 1) {
      console.error(`FAIL: Main pane width ${mainPane.w} deviates too much from expected ${expectedMainWidth}`);
      process.exit(1);
    }

    // Column count assertion (3 columns expected for 8 subagents with max 3 per column)
    const uniqueLefts = new Set(panesInfo.map(p => p.l));
    console.log(`Unique X offsets (columns): ${Array.from(uniqueLefts).sort((a, b) => a - b).join(', ')}`);
    
    // We expect 1 main pane column + 3 subagent columns = 4 total columns
    if (uniqueLefts.size !== 4) {
       console.error(`FAIL: Expected 4 columns (1 main + 3 subagent), found ${uniqueLefts.size}`);
       process.exit(1);
    }

    // Check distribution in columns
    const sortedLefts = Array.from(uniqueLefts).sort((a, b) => a - b);
    const colCounts = sortedLefts.map(x => panesInfo.filter(p => p.l === x).length);
    console.log(`Panes per column: ${colCounts.join(', ')}`);
    // Expected: [1 (main), 3, 3, 2]
    const expectedCounts = [1, 3, 3, 2];
    if (JSON.stringify(colCounts) !== JSON.stringify(expectedCounts)) {
        console.error(`FAIL: Distribution mismatch. Got [${colCounts}], expected [${expectedCounts}]`);
        process.exit(1);
    }

    console.log("PASS");
  } catch (err) {
    console.error("FAIL:", err);
    process.exit(1);
  } finally {
    // 7. Cleanup
    console.log(`Cleaning up session ${SESSION_NAME}...`);
    try {
      execSync(`tmux kill-session -t ${SESSION_NAME} 2>/dev/null`);
    } catch (e) {
      // ignore
    }
  }
}

runVerification();
