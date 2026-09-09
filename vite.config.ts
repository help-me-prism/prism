import { defineConfig } from 'vite'
import { cpSync } from 'node:fs'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react(), { name: 'pdf-reading-resources', closeBundle() { for (const directory of ['standard_fonts', 'cmaps', 'wasm']) cpSync(`node_modules/pdfjs-dist/${directory}`, `dist/pdfjs/${directory}`, { recursive: true }) } }],
  base: './',
  build: { sourcemap: true, target: 'chrome130', cssTarget: 'chrome130' },
})
