import { test, expect, type Page } from '@playwright/test';

/** 運転手の1運行を通しで確認する。Apps Script 版で実機に出してしまった
 *  「案内どおりに押せない」「順序を守らずに記録できる」を、ここで先に潰す。
 *  ?mock=1 はメモリ実装。Firestore 実装も同じ規則で動く（store/firestore.ts）。 */
async function unlock(page: Page) {
  await page.goto('./?mock=1');
  await page.getByTestId('pw').fill('mock');
  await page.getByTestId('login').click();
  await page.getByTestId('pick-driver').click();
  await page.getByRole('button', { name: '運転者H' }).click();
  await page.getByTestId('pick-vehicle').click();
  await page.getByRole('button', { name: 'パッソ' }).click();
}

test('パスワードが違うと入れない', async ({ page }) => {
  await page.goto('./?mock=1');
  await page.getByTestId('pw').fill('ちがうやつ');
  await page.getByTestId('login').click();
  await expect(page.getByTestId('pw-error')).toHaveText('パスワードが違います');
  await expect(page.getByTestId('pick-driver')).toBeHidden();
});

test('運転前チェックを記録するまで出発できない', async ({ page }) => {
  await unlock(page);
  await expect(page.getByTestId('depart')).toBeDisabled();
  await expect(page.getByTestId('today')).toContainText('運転前のアルコールチェックから');
  await expect(page.getByTestId('alc-運転後')).toHaveText('運転前を記録してから');

  await page.getByTestId('alc-record-運転前').click();
  await expect(page.getByTestId('alc-運転前')).toContainText('✓ 0.00');
  await expect(page.getByTestId('depart')).toBeEnabled();
});

test('出発から拠点到着までを記録できる', async ({ page }) => {
  await unlock(page);
  await page.getByTestId('alc-record-運転前').click();
  await page.getByTestId('depart').click();
  await expect(page.getByTestId('enroute')).toContainText('運行中');

  await page.getByRole('button', { name: /渡慶次小学校/ }).click();
  await expect(page.getByTestId('at-school')).toContainText('渡慶次小学校');

  // 人数を選ぶまで出発できない
  await expect(page.getByTestId('board')).toBeDisabled();
  await page.getByRole('button', { name: '2', exact: true }).click();
  await expect(page.getByTestId('board')).toBeEnabled();
  await page.getByTestId('board').click();

  await expect(page.getByTestId('enroute')).toContainText('乗車 2人');
  await page.getByTestId('return').click();
  await page.getByTestId('finish').click();

  await expect(page.getByText('本日の運行（全車両）')).toBeVisible();
  await expect(page.getByText('パッソ・運転者H・2人')).toBeVisible();

  // 1回運行したあとは、次にやることが2つとも見えている
  await expect(page.getByTestId('today')).toContainText('本日 1回 運行しました');
  await expect(page.getByTestId('depart')).toHaveText(/もう1度 出発する（本日 2 回目）/);
  await expect(page.getByRole('button', { name: /本日の運転を終える/ })).toBeVisible();
  await page.screenshot({ path: 'tests/shot-driving.png', fullPage: true });
});

test('運転後を記録すると、終了したことが画面で分かる', async ({ page }) => {
  await unlock(page);
  await page.getByTestId('alc-record-運転前').click();
  await expect(page.getByTestId('today')).toContainText('出発できます');

  await page.getByTestId('depart').click();
  await page.getByTestId('return').click();
  await page.getByTestId('finish').click();
  await expect(page.getByTestId('today')).toContainText('本日 1回 運行しました');

  await page.getByRole('button', { name: /本日の運転を終える/ }).click();
  await expect(page.getByTestId('today')).toContainText('本日の運転は終了しました');
  await expect(page.getByTestId('alc-運転後')).toContainText('✓ 0.00');
  // 出発ボタンは残るが、押しても止まるようにしてある
  await expect(page.getByTestId('depart')).toHaveText(/もう1度 出発する/);
  page.on('dialog', d => d.dismiss());
  await page.getByTestId('depart').click();
  await expect(page.getByTestId('today')).toContainText('本日の運転は終了しました');
  await page.screenshot({ path: 'tests/shot-finished.png', fullPage: true });
});

test('運行をリセットすると記録が残らない', async ({ page }) => {
  await unlock(page);
  await page.getByTestId('alc-record-運転前').click();
  await page.getByTestId('depart').click();
  await page.getByRole('button', { name: /古堅小学校/ }).click();

  page.on('dialog', d => d.accept());
  await page.getByTestId('reset').click();

  await expect(page.getByTestId('depart')).toBeEnabled();     // 出発前の画面に戻る
  await expect(page.getByText('本日の運行（全車両）')).toBeHidden();
});

test('画面を撮る', async ({ page }) => {
  await unlock(page);
  await page.screenshot({ path: 'tests/shot-idle.png', fullPage: true });
  await page.getByTestId('alc-record-運転前').click();
  await page.getByTestId('depart').click();
  await page.getByRole('button', { name: /渡慶次小学校/ }).click();
  await page.screenshot({ path: 'tests/shot-school.png', fullPage: true });
  await page.getByRole('button', { name: '2', exact: true }).click();
  await page.getByTestId('board').click();
  await page.getByTestId('return').click();
  await page.screenshot({ path: 'tests/shot-return.png', fullPage: true });
});

test('Firebase 接続版はパスワードを聞く', async ({ page }) => {
  // 起動時に落ちて真っ白、を防ぐための最低限の確認。
  await page.goto('./');
  await expect(page.getByTestId('login')).toBeVisible();
  await expect(page.getByTestId('pick-driver')).toBeHidden();
});

test('ログイン画面を撮る', async ({ page }) => {
  await page.goto('./?mock=1');
  await page.screenshot({ path: 'tests/shot-login.png' });
  await page.getByTestId('pw').fill('ちがうやつ');
  await page.getByTestId('login').click();
  await expect(page.getByTestId('pw-error')).toHaveText('パスワードが違います');
  await page.screenshot({ path: 'tests/shot-login-ng.png' });
});
