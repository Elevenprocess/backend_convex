import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    // Les tests tournent en mode NestJS : sans ça, le VITE_CONVEX_URL du .env
    // local basculerait useLeads & co sur Convex sans ConvexProvider monté.
    // Les tests du mode Convex re-stubbent la variable explicitement.
    env: { VITE_CONVEX_URL: '' },
  },
})
