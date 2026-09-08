import { defineConfig } from 'vite';
import { resolve } from 'node:path';

/** 運転手アプリ（/）と管理画面（/admin.html）の2画面をそれぞれ書き出す。
 *  GitHub Pages はリポジトリ名のサブパスで配信されるので、base をそれに合わせる
 *  （https://k-three.github.io/yomicam-driving/）。開発サーバーも同じ形にして、
 *  本番だけ経路が違う、という取りこぼしを防ぐ。 */
export default defineConfig({
  base: '/yomicam-driving/',
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
