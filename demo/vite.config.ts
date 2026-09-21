import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// The library lives at the repo root (../src). Vite resolves its `.ts`
// specifiers directly, so no build step or link is needed. We widen fs.allow so
// Vite is permitted to read the parent directory (the library source).
export default defineConfig({
  plugins: [vue()],
  server: { port: 5173, fs: { allow: ['..'] } },
  build: { outDir: 'dist' },
})
