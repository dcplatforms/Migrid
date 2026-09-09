import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Proxy API calls to the L8 Energy Manager service during development.
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET || 'http://localhost:3008',
        changeOrigin: true,
      },
    },
  },
})
