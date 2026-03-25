import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['plugin/src/index.ts'],
  format: 'esm',
  dts: true,
  outDir: 'dist',
  external: ['@vscode/sqlite3'],
  noExternal: ['qrcode-terminal'],
  tsconfig: './tsconfig.build.json',
})
