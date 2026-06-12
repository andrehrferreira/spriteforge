import { defineConfig } from 'vite'

export default defineConfig({
    server: {
        proxy: {
            // servidor local de backups (server/server.mjs)
            '/api': 'http://127.0.0.1:5175',
        },
    },
})
