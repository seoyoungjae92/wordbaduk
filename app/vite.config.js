import { defineConfig } from 'vite';

export default defineConfig({
  // 미니앱 번들은 상대 경로로 서빙된다
  base: './',
  server: { host: 'localhost', port: 5173 },
  build: {
    outDir: 'dist',
    // 사전(2.4MB)은 public/ 자산이라 번들에 인라인되지 않는다
    assetsInlineLimit: 4096,
  },
});
