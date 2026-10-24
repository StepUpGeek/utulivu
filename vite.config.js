import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['matondo-logo.svg', 'icon-180.png'],
      manifest: {
        name: 'Matondo Guest House',
        short_name: 'Matondo',
        description: 'Guest house management, works offline.',
        theme_color: '#16233B',
        background_color: '#F6F3ED',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/matondo-logo.svg', sizes: 'any', type: 'image/svg+xml' }
        ]
      },
      workbox: {
        // Cache the app shell (HTML/CSS/JS) so the app loads with zero internet.
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        runtimeCaching: [
          {
            // Never let the service worker try to cache/serve Supabase API calls —
            // those are handled by our own offline queue/cache logic instead.
            urlPattern: /supabase\.co/,
            handler: 'NetworkOnly'
          }
        ]
      }
    })
  ],
})