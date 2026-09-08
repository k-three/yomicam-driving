import { defineConfig } from 'vitest/config';

/** ブラウザを起動する Playwright のテスト（tests/）とは分ける。
 *  こちらは集計ロジックなど、ブラウザ無しで確かめられるものだけ。 */
export default defineConfig({
  test: { include: ['src/**/*.test.ts'] },
});
