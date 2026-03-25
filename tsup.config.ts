import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['plugin/src/index.ts'],
  format: 'esm',
  dts: true,
  outDir: 'dist',
  external: ['better-sqlite3'],
  noExternal: ['qrcode-terminal'],
  tsconfig: './tsconfig.build.json',
})
