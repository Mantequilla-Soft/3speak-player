import { defineConfig } from 'tsup';

export default defineConfig([
  // Core (framework-agnostic)
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    external: ['react'],
    treeshake: true,
    minify: false,
  },
  // React adapter (optional)
  {
    entry: { react: 'src/react.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    external: ['react', 'hls.js'],
    treeshake: true,
    minify: false,
  },
]);
