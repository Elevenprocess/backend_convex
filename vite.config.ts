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
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('node_modules/recharts')) return 'recharts'
          if (id.includes('node_modules/ogl')) return 'ogl'
          if (id.includes('node_modules/socket.io-client')) return 'socket'
          if (id.includes('node_modules/ai')) return 'ai'
          if (id.includes('node_modules/@ai-sdk/react')) return 'ai'
        },
      },
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
    // Les pages sont lazy : sans warmup, la PREMIÈRE visite de chaque page paie
    // la transformation à la demande — très lent à travers le bind-mount Docker
    // (2-3 s ressenties). On préchauffe le chemin chaud dès le boot du serveur.
    warmup: {
      clientFiles: [
        './src/main.tsx',
        './src/pages/Login.tsx',
        './src/pages/leads/LeadsList.tsx',
        './src/pages/leads/LeadsSplit.tsx',
        './src/pages/leads/LeadDetail.tsx',
        './src/pages/Overview.tsx',
      ],
    },
  },
})
