import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'bin/opencode-tmux': 'src/bin/opencode-tmux.ts',
    'scripts/install': 'src/scripts/install.ts',
    'scripts/update-plugins': 'src/scripts/update-plugins.ts',
  },
  format: ['esm'],
  dts: {
    entry: ['src/index.ts']
  },
  clean: true,
  splitting: false,
  sourcemap: false,
  minify: false,
  target: 'esnext',
  outDir: 'dist',
  shims: true
});
