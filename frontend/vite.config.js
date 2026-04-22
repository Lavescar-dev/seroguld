import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
export default defineConfig(function (_a) {
    var command = _a.command;
    var frontendMode = command === 'serve' ? 'vite-dev' : 'embedded-dist';
    var builtAt = new Date().toISOString();
    var routeChunkMatchers = [
        { name: 'route-alis', match: '/src-v2/make/alis/' },
        { name: 'route-depolama', match: '/src-v2/make/depolama/' },
        { name: 'route-log', match: '/src-v2/make/log/' },
        { name: 'route-gdpr', match: '/src-v2/make/gdpr/' },
        { name: 'route-woocommerce', match: '/src-v2/make/woocommerce/' },
        { name: 'route-office', match: '/src-v2/make/office/' },
    ];
    return {
        plugins: [react()],
        define: {
            __SERO_FRONTEND_MODE__: JSON.stringify(frontendMode),
            __SERO_FRONTEND_BUILT_AT__: JSON.stringify(builtAt),
        },
        resolve: {
            alias: {
                '@': path.resolve(__dirname, './src-v2'),
            },
        },
        build: {
            outDir: 'dist',
            rollupOptions: {
                output: {
                    manualChunks: function (id) {
                        if (id.includes('node_modules')) {
                            if (id.includes('/xlsx/'))
                                return 'vendor-xlsx';
                            if (id.includes('/recharts/'))
                                return 'vendor-charts';
                            if (id.includes('@tauri-apps/api'))
                                return 'vendor-tauri';
                            if (id.includes('react-router'))
                                return 'vendor-router';
                            if (id.includes('@tanstack/react-query'))
                                return 'vendor-query';
                            if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) {
                                return 'vendor-react';
                            }
                            return 'vendor';
                        }
                        for (var _i = 0, routeChunkMatchers_1 = routeChunkMatchers; _i < routeChunkMatchers_1.length; _i++) {
                            var entry = routeChunkMatchers_1[_i];
                            if (id.includes(entry.match)) {
                                return entry.name;
                            }
                        }
                        return undefined;
                    },
                },
            },
        },
        server: {
            host: '127.0.0.1',
            port: 3300,
        },
    };
});
