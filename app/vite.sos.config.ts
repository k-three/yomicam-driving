import { defineConfig } from 'vite';
import { resolve } from 'node:path';

/** 虎の巻など、送迎記録の外のページに置く「🚨 緊急」の部品を、決まった名前の
 *  1ファイル（dist/sos-widget.js）として書き出す。alert.js がこの名前で読み込むので、
 *  通常のビルドのように名前に版数（ハッシュ）を付けない。
 *  通常のビルドの後に実行し、dist の中身は消さない。 */
export default defineConfig({
  base: '/yomicam-driving/',
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    copyPublicDir: false,
    lib: {
      entry: resolve(import.meta.dirname, 'src/sos/widget.ts'),
      // 普通の <script> で読み込める形にし、window.YomicamSos.open() を生やす
      formats: ['iife'],
      name: 'YomicamSos',
      fileName: () => 'sos-widget.js',
    },
    // 虎の巻の利用者が読み込む量を減らす
    minify: true,
    chunkSizeWarningLimit: 800,
  },
});
