import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  // Chemins relatifs : indispensable pour que les assets fonctionnent
  // dans la WebView Android de Capacitor (pas de serveur, fichiers locaux)
  base: './',

  // epub.js utilise des globals Node.js (path, fs) que Vite doit polyfiller
  define: {
    global: 'globalThis',
  },

  optimizeDeps: {
    include: ['epubjs'],
  },

  build: {
    target: 'es2020',
    commonjsOptions: {
      include: [/epubjs/, /node_modules/],
      transformMixedEsModules: true,
    },
  },

  css: {
    postcss: './postcss.config.js',
  },

  server: {
    port: 5175,
    strictPort: false,
    // Headers pour permettre les Web Speech API et AudioContext
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
    }
  },
})
