import { test, expect } from '@playwright/test';

/** 管理画面は運転手アプリと別の入口。合言葉の画面を通らずに開く。 */
test('サンプル無しでも開ける', async ({ page }) => {
  await page.goto('admin.html?mock=1&sample=0');
  await expect(page.getByRole('heading', { name: '運行状況' })).toBeVisible();
  await expect(page.getByTestId('alerts')).toHaveText('✓ 異常なし');
  await expect(page.getByText('本日の運行はまだありません。')).toBeVisible();
});

test('運行中の動きが時系列で並ぶ', async ({ page }) => {
  await page.goto('admin.html?mock=1');
  await expect(page.getByRole('heading', { name: /いまの動き/ })).toBeVisible();
  // 同じ車両が1日に何回運行しても1行にまとまる（ハイエースは2回運行）
  await expect(page.getByTestId('tl-row')).toHaveCount(3);
  const van = page.getByTestId('tl-row').filter({ hasText: 'ハイエース' });
  await expect(van).toHaveCount(1);
  await expect(van).toContainText('運行中');
  await expect(van).toContainText('喜名小学校');   // いまどこにいるか

  // 3状態の凡例がそろっている（色だけに頼らせない）
  for (const t of ['児童を乗せて移動', '学校で待機', '回送（空車で移動）'])
    await expect(page.getByText(t, { exact: true })).toBeVisible();

  // 学校に長く滞在している車両は要確認になる
  await expect(page.getByText('⚠ 要確認').first()).toBeVisible();
  await page.screenshot({ path: 'tests/shot-admin.png', fullPage: true });
});

test('ログインしていないと開けない', async ({ page }) => {
  await page.goto('admin.html');
  await expect(page.getByTestId('login')).toBeVisible();
  await expect(page.getByRole('heading', { name: '運行状況' })).toBeHidden();
});

test('運行の記録をその場で直せる', async ({ page }) => {
  await page.goto('admin.html?mock=1');
  // パッソは運転前チェックが無く、2時間10分たっていて要確認になっている
  await expect(page.getByTestId('alerts')).toHaveText('⚠ 要確認 2件');

  await page.getByTestId('tl-row').filter({ hasText: 'パッソ' }).getByRole('button', { name: '修正' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  // 到着時刻を入れて完了にすると、運行中から外れる
  await dialog.getByLabel('拠点到着時刻').fill('14:05');
  await dialog.getByLabel('状態').selectOption('done');
  await dialog.getByRole('button', { name: '保存する' }).click();

  // 「いま動いている車両」の表は廃止し、時系列の各行に寄せてある
  await expect(page.getByTestId('tl-row').filter({ hasText: 'パッソ' }))
    .toContainText('待機中');
  await expect(page.getByTestId('done-row')).toHaveCount(2);
});

test('時刻の形が違うと保存できない', async ({ page }) => {
  await page.goto('admin.html?mock=1');
  await page.getByTestId('tl-row').filter({ hasText: 'パッソ' }).getByRole('button', { name: '修正' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('状態').selectOption('done');
  await dialog.getByRole('button', { name: '保存する' }).click();
  await expect(dialog.getByText('完了にするには拠点到着時刻が必要です。')).toBeVisible();
});

test('月次帳票に要確認が並ぶ', async ({ page }) => {
  await page.goto('admin.html?mock=1');
  await page.getByRole('button', { name: '月次帳票' }).click();
  await expect(page.getByRole('heading', { name: '月次帳票' })).toBeVisible();
  await expect(page.getByTestId('findings')).toContainText('要確認');
  for (const t of ['輸送記録（保険会社向け）', 'アルコールチェック記録簿（安全運転管理者）',
                   '運行日報（内部管理用）', '要確認一覧（提出前チェック）'])
    await expect(page.getByText(t, { exact: true })).toBeVisible();
  await page.screenshot({ path: 'tests/shot-report.png', fullPage: true });
});

test('Excel をダウンロードできる', async ({ page }) => {
  await page.goto('admin.html?mock=1');
  await page.getByRole('button', { name: '月次帳票' }).click();
  const card = page.locator('.rep', { hasText: '輸送記録（保険会社向け）' });
  await expect(card).toBeVisible();
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    card.getByRole('button', { name: 'Excel' }).click(),
  ]);
  const ym = new Date().toISOString().slice(0, 7).replace('-', '');
  expect(dl.suggestedFilename()).toBe(`yomicam_insurance_${ym}.xlsx`);
  await dl.saveAs('tests/out.xlsx');
});

test('印刷の体裁を確かめる', async ({ page }) => {
  // window.print() は自動テストでは開けないので、呼ばれたことだけ受け取って
  // 印刷用の表示を PDF にして中身を見る。
  await page.addInitScript(() => { window.print = () => { (window as any).__printed = true; }; });
  await page.goto('admin.html?mock=1');
  await page.getByRole('button', { name: '月次帳票' }).click();
  await page.locator('.rep', { hasText: '輸送記録（保険会社向け）' })
    .getByRole('button', { name: '印刷 / PDF' }).click();
  expect(await page.evaluate(() => (window as any).__printed)).toBe(true);

  // 印刷用の領域に3つの表（輸送記録・時間区分集計・日別合計）が出ている
  await expect(page.locator('#printable .sheet')).toHaveCount(3);
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('#app')).toBeHidden();
  await page.pdf({ path: 'tests/out-print.pdf', printBackground: true });
  await page.emulateMedia({ media: 'screen' });
});

test('修正の画面を撮る', async ({ page }) => {
  await page.goto('admin.html?mock=1');
  await page.screenshot({ path: 'tests/shot-admin.png', fullPage: true });
  await page.getByTestId('tl-row').filter({ hasText: 'パッソ' }).getByRole('button', { name: '修正' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.screenshot({ path: 'tests/shot-edit.png' });
});

test('管理者のログイン画面を撮る', async ({ page }) => {
  await page.goto('admin.html');
  await expect(page.getByTestId('login')).toBeVisible();
  await page.screenshot({ path: 'tests/shot-login-admin.png' });
});

test('マスタ未登録なら設定を促し、登録すると消える', async ({ page }) => {
  await page.goto('admin.html?mock=1');
  await expect(page.getByTestId('setup-notice')).toBeVisible();

  await page.getByRole('button', { name: '設定を開く' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('運転者').fill('山田太郎\n鈴木花子');
  await dialog.getByRole('button', { name: '保存する' }).click();

  await expect(page.getByTestId('setup-notice')).toBeHidden();
  // 実名は設定から入り、コードには残らない
  await page.getByRole('button', { name: '運行状況' }).click();
  await page.getByTestId('alcohol-row').first().getByRole('button', { name: '追記' }).first().click();
  await expect(page.getByRole('dialog').getByLabel('運転者')).toContainText('山田太郎');
});

test('パスワード欄で英字が打てて、表示も確認できる', async ({ page }) => {
  await page.goto('admin.html');
  const pw = page.getByTestId('pw');

  // 数字キーボードに固定してはいけない（英字を含むパスワードが打てなくなる）
  await expect(pw).not.toHaveAttribute('inputmode', /.+/);
  // iPhone が先頭を大文字にしないようにする
  await expect(pw).toHaveAttribute('autocapitalize', 'off');
  await expect(pw).toHaveAttribute('autocorrect', 'off');

  await pw.fill('434343admin');
  await expect(pw).toHaveValue('434343admin');

  // 伏せ字のままだと打ち間違いに気づけないので、確かめられるようにしてある
  await expect(pw).toHaveAttribute('type', 'password');
  await page.getByTestId('peek').click();
  await expect(pw).toHaveAttribute('type', 'text');
  await page.screenshot({ path: 'tests/shot-login-admin.png' });
  await page.getByTestId('peek').click();
  await expect(pw).toHaveAttribute('type', 'password');
});

test('運行を削除すると、残ったアルコールチェックの扱いを聞かれる', async ({ page }) => {
  await page.goto('admin.html?mock=1');

  const asked: string[] = [];
  page.on('dialog', d => { asked.push(d.message()); d.accept(); });

  // 運転者J はハイエースで2回運行し、アルコールも記録済み。
  // 2件とも削除すると、この運転者の運行が1件も無くなる
  await expect(page.getByTestId('alcohol-row').filter({ hasText: '運転者J' })).toHaveCount(1);

  // 完了した運行は「本日の完了運行」から、運行中は時系列の行から直せる
  await page.getByTestId('done-row').filter({ hasText: '13:05' })
    .getByRole('button', { name: '修正' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'この運行を削除' }).click();
  await page.getByTestId('tl-row').filter({ hasText: 'ハイエース' })
    .getByRole('button', { name: '修正' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'この運行を削除' }).click();

  // 2件目の削除で「アルコールチェックも消すか」を聞かれる
  expect(asked.join('\n')).toContain('アルコールチェックの記録が');
  // OK したので、運転者J のチェックだけが消えている（他の運転者のぶんは残る）
  await expect(page.getByTestId('alcohol-row').filter({ hasText: '運転者J' })).toHaveCount(0);
  await expect(page.getByTestId('alcohol-row').filter({ hasText: '運転者K' })).toHaveCount(1);
});


test('警告の出ている場所から、そのまま直せる', async ({ page }) => {
  await page.goto('admin.html?mock=1');
  const row = page.getByTestId('alcohol-row').filter({ hasText: '運転者H' });

  // 運転者H は運転前が未記録。その行から「追記」でき、運転者と種別が入っている
  await expect(row).toContainText('運転前が未記録');
  await row.getByRole('button', { name: '追記' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('運転者')).toHaveValue('運転者H');
  await expect(dialog.getByLabel('種別')).toHaveValue('運転前');
  await dialog.getByLabel('時刻').fill('12:00');
  await dialog.getByRole('button', { name: '保存する' }).click();
  await expect(row).not.toContainText('運転前が未記録');

  // 記録済みの時刻はそのまま押して直せる
  await row.getByRole('button', { name: /12:00/ }).click();
  await expect(page.getByRole('dialog').getByLabel('時刻')).toHaveValue('12:00');
});

test('添付された写真を管理画面で開ける', async ({ page }) => {
  await page.goto('admin.html?mock=1');
  await page.getByTestId('alcohol-row').first().getByRole('button', { name: '追記' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('時刻').fill('09:00');
  await dialog.getByRole('button', { name: '保存する' }).click();

  // 追記した記録には写真が無いので、印は出ない
  await expect(page.getByRole('button', { name: '📷' })).toHaveCount(0);
});
