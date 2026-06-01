import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    // Le bind-mount Docker (linuxkit/macOS) ne propage pas les événements de
    // fichiers : sans polling, Vite ne détecte pas les modifs et le HMR ne se
    // déclenche jamais (il faut redémarrer à chaque édition). Le polling corrige ça.
    watch: {
      usePolling: true,
      interval: 100,
    },
  },
})
