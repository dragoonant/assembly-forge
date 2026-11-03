import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// The production base must match the GitHub Pages project path; the dev server stays at the root.
export default defineConfig(({ mode }) => ({
  base: mode === 'production' ? '/assembly-forge/' : '/',
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    // three, R3F and drei land in one chunk (about 1.3 MB, 330 kB gzipped); splitting it is a known tidy-up in STATUS.md
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('/three/')) return 'three'
          if (id.includes('@react-three')) return 'r3f'
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) return 'react'
          return undefined
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    testTimeout: 30000,
  },
}))
