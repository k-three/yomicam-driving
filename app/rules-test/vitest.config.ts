import { defineConfig } from 'vitest/config';

/** セキュリティルールの検証。Firestore エミュレータが要るので、
 *  ふだんの npm test（集計ロジック）とは分けて実行する。 */
export default defineConfig({
  test: { include: ['rules-test/**/*.test.ts'], testTimeout: 20_000, hookTimeout: 30_000 },
});
