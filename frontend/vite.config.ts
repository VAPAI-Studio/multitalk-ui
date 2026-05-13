import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: '0.0.0.0',
    // Allow access via Cloudflare tunnel (applocal.vapai.studio)
    allowedHosts: ['applocal.vapai.studio'],
    proxy: {
      // Forward all /api calls to the local backend — works both on localhost
      // and when accessed via the Cloudflare tunnel from other devices
      '/api': {
        target: 'http://localhost:8001',
        changeOrigin: true,
      },
    },
  },
})
