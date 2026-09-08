import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

/** この開発環境には Chromium が同梱されているが、Playwright の版と
 *  ブラウザのビルド番号が一致しないため、実体を直接指す。
 *  CI（GitHub Actions）では playwright install が入れたものを使うので、
 *  見つからなければ Playwright に任せる。 */
const BUNDLED = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const CHROMIUM = process.env.CHROMIUM_PATH || (existsSync(BUNDLED) ? BUNDLED : '');

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:5173/yomicam-driving/',
    launchOptions: { ...(CHROMIUM ? { executablePath: CHROMIUM } : {}), args: ['--no-sandbox'] },
  },
  projects: [
    // 運転手はスマホ、管理者はPC。それぞれ実際に使う画面幅で確かめる
    { name: 'driver', testMatch: /driver\.spec\.ts/, use: { ...devices['Pixel 7'] } },
    { name: 'admin', testMatch: /admin\.spec\.ts/, use: { viewport: { width: 1280, height: 900 } } },
  ],
  webServer: {
    command: 'npx vite --port 5173 --host 127.0.0.1',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
