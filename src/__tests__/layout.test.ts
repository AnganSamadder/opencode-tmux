import { expect, test } from 'bun:test';

import {
  buildMainVerticalMultiColumnLayoutString,
  layoutChecksum,
} from '../layout';

test('layoutChecksum matches tmux layout_checksum', () => {
  const layout = '80x24,0,0{40x24,0,0,129,39x24,41,0,130}';
  expect(layoutChecksum(layout)).toBe(0x6c56);
});

test('buildMainVerticalMultiColumnLayoutString prefixes correct checksum', () => {
  const built = buildMainVerticalMultiColumnLayoutString({
    windowWidth: 80,
    windowHeight: 24,
    mainPaneWpId: 129,
    columns: [[130], [131]],
    mainPanePercent: 45,
  });

  const firstComma = built.indexOf(',');
  expect(firstComma).toBeGreaterThan(0);

  const checksumHex = built.slice(0, firstComma);
  expect(checksumHex).toMatch(/^[0-9a-f]{4}$/);

  const layout = built.slice(firstComma + 1);
  const computed = layoutChecksum(layout).toString(16).padStart(4, '0');
  expect(checksumHex).toBe(computed);
});
