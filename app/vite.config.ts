import { defineConfig } from 'vite';
import { resolve } from 'node:path';

/** 運転手アプリ（/）と管理画面（/admin.html）の2画面をそれぞれ書き出す。
 *  GitHub Pages はリポジトリ名のサブパスで配信されるので、base をそれに合わせる
 *  （https://k-three.github.io/yomicam-driving/）。開発サーバーも同じ形にして、
 *  本番だけ経路が違う、という取りこぼしを防ぐ。 */
export default defineConfig({
  base: '/yomicam-driving/',
  plugins: [{
    // 開発サーバーでは、虎の巻向けの部品（本番は dist/sos-widget.js）を元のソースから配る。
    // 自動テストで alert.js → sos-widget.js の読み込みを本番と同じ経路で確かめるため
    name: 'sos-widget-dev',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/yomicam-driving/sos-widget.js')) return next();
        // 本番は普通の <script>（IIFE）。開発ではソースをモジュールとして読み、同じ名前で生やす
        res.setHeader('Content-Type', 'text/javascript');
        res.end(`import('/yomicam-driving/src/sos/widget.ts').then(m => {
          window.YomicamSos = m; window.dispatchEvent(new Event('yomicam-sos-ready'));
        });`);
      });
    },
  }],
  // 画面下に出す版数。古い画面が残っているかどうかを、その場で判別できるようにする
  define: {
    __BUILD__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC'),
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        admin: resolve(import.meta.dirname, 'admin.html'),
      },
    },
    // Firebase SDK が大きいので、共通部分を切り出したうえで警告の基準を上げる
    chunkSizeWarningLimit: 800,
  },
});
