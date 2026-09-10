import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const target = (port: number) => ({
  target: `http://localhost:${port}`,
  changeOrigin: true,
})

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Proxy each page's API prefix to its owning MiGrid layer service.
    proxy: {
      '/api/site': target(3008), // L8 Energy Manager
      '/api/sessions': target(3001), // L1 Physics Engine
      '/api/market': target(3004), // L4 Market Gateway
      '/api/drivers': target(3006), // L6 Engagement Engine
    },
  },
})
