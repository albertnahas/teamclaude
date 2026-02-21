import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: 'dist',
    // viteSingleFile inlines all assets; assetsInlineLimit must be high enough
    assetsInlineLimit: 100_000_000,
  },
})
