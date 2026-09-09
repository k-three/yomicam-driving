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
  await page.getByTestId('note').fill('道路工事で迂回した');
  await page.getByTestId('finish').click();

  await expect(page.getByText('本日の運行（全車両）')).toBeVisible();
  // どこへ行って何人乗せたかが、その場で読める
  await expect(page.getByText('渡慶次小学校 2人')).toBeVisible();
  await expect(page.getByText('合計 2人')).toBeVisible();

  // 1回運行したあとは、次にやることが2つとも見えている
  await expect(page.getByTestId('today')).toContainText('本日 1回 運行しました');
  await expect(page.getByTestId('depart')).toHaveText(/もう1度 出発する（本日 2 回目）/);
  await expect(page.getByRole('button', { name: /本日の運転を終える/ })).toBeVisible();

  // 入れたメモは、管理者が直す画面から確認できる
  await page.getByRole('button', { name: '修正' }).click();
  await expect(page.getByRole('dialog').getByLabel('特記')).toHaveValue('道路工事で迂回した');
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
  await page.screenshot({ path: 'tests/shot-finished.png', fullPage: true });
});

test('運転後のあとでも、取り消さずに もう1度 出発できる', async ({ page }) => {
  const at = (hm: string) => page.evaluate(t =>
    (window as unknown as { setClock: (s: string) => void }).setClock(t), hm);

  await unlock(page);
  await at('09:00'); await page.getByTestId('alc-record-運転前').click();
  await at('09:10'); await page.getByTestId('depart').click();
  await at('09:40'); await page.getByTestId('return').click();
  await page.getByTestId('finish').click();
  await at('09:45'); await page.getByRole('button', { name: /本日の運転を終える/ }).click();
  await expect(page.getByTestId('today')).toContainText('本日の運転は終了しました');

  // 取り消しを求めず、そのまま出発できる。ただし終わったときに気づかせる
  const notices: string[] = [];
  page.on('dialog', d => { notices.push(d.message()); d.accept(); });
  await at('14:00'); await page.getByTestId('depart').click();
  await expect(page.getByTestId('enroute')).toContainText('運行中');
  await at('14:50'); await page.getByTestId('return').click();
  await page.getByTestId('finish').click();
  await expect.poll(() => notices.join('\n')).toContain('もう1度記録してください');

  // 戻ったら「記録し直してください」に変わる。運転後は残ったまま
  await expect(page.getByTestId('today')).toContainText('記録し直してください');
  await expect(page.getByTestId('alc-運転後')).toContainText('✓ 0.00');
  await expect(page.getByRole('button', { name: /記録し直す/ })).toBeVisible();

  await page.getByRole('button', { name: /記録し直す/ }).click();
  await expect(page.getByTestId('today')).toContainText('本日の運転は終了しました');
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

test('自分の運行を、その場で直せる', async ({ page }) => {
  await unlock(page);
  await page.getByTestId('alc-record-運転前').click();
  await page.getByTestId('depart').click();
  await page.getByRole('button', { name: /渡慶次小学校/ }).click();
  await page.getByRole('button', { name: '2', exact: true }).click();
  await page.getByTestId('board').click();
  await page.getByTestId('return').click();
  await page.getByTestId('finish').click();

  // 最後に拠点へ戻った時刻が出ている
  await expect(page.getByTestId('today')).toContainText('最後に拠点へ戻ったのは');

  await page.getByRole('button', { name: '修正' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('拠点到着時刻').fill('17:30');
  await dialog.getByRole('button', { name: '保存する' }).click();

  await expect(page.getByTestId('today')).toContainText('最後に拠点へ戻ったのは 17:30');
  await expect(page.getByText(/〜17:30/)).toBeVisible();
  await page.screenshot({ path: 'tests/shot-driving.png', fullPage: true });
});

test('誤って記録した運行を、運転手が自分で削除できる', async ({ page }) => {
  const asked: string[] = [];
  page.on('dialog', d => { asked.push(d.message()); d.accept(); });

  await unlock(page);
  await page.getByTestId('alc-record-運転前').click();
  await page.getByTestId('depart').click();
  await page.getByTestId('return').click();
  await page.getByTestId('finish').click();
  await expect(page.getByText('本日の運行（全車両）')).toBeVisible();

  await page.getByRole('button', { name: '修正' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'この運行を削除' }).click();

  // 運行は消え、出発前の画面に戻る
  await expect(page.getByText('本日の運行（全車両）')).toBeHidden();
  // 残るアルコールチェックの扱いも聞かれる（法定記録なので自動では消さない）
  expect(asked.join('\n')).toContain('アルコールチェックの記録が');
});

test('運行を全部消したら「終了しました」ではなく、チェックの削除を促す', async ({ page }) => {
  // 削除の確認は通し、アルコールをまとめて消すかどうかは断る
  page.on('dialog', d => (d.message().includes('アルコールチェックの記録が')
    ? d.dismiss() : d.accept()));

  await unlock(page);
  await page.getByTestId('alc-record-運転前').click();
  await page.getByTestId('depart').click();
  await page.getByTestId('return').click();
  await page.getByTestId('finish').click();
  await page.getByRole('button', { name: /本日の運転を終える/ }).click();
  await expect(page.getByTestId('today')).toContainText('本日の運転は終了しました');

  // 運行を消すと、運行が無いのにチェックだけ残った状態になる
  await page.getByRole('button', { name: '修正' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'この運行を削除' }).click();

  await expect(page.getByTestId('today')).toContainText('本日の運行がありません');
  await expect(page.getByTestId('today')).not.toContainText('終了しました');
  await page.screenshot({ path: 'tests/shot-orphan.png', fullPage: true });

  // その場でまとめて消せる
  await page.getByTestId('clear-alc').click();
  await expect(page.getByTestId('alc-record-運転前')).toBeVisible();   // 未記録に戻る
  await expect(page.getByTestId('today')).toContainText('運転前のアルコールチェックから');
});

test('運転手も全車両の運行状況を見られる（直せはしない）', async ({ page }) => {
  await unlock(page);
  await page.getByTestId('alc-record-運転前').click();
  await page.getByTestId('depart').click();

  await page.getByRole('button', { name: '運行状況' }).click();
  await expect(page.getByRole('heading', { name: /いまの動き/ })).toBeVisible();
  await expect(page.getByTestId('tl-row').filter({ hasText: 'パッソ' })).toContainText('運行中');
  await expect(page.getByText('見るだけの画面です')).toBeVisible();

  // 直す導線は出ない（運転手は読み取りだけ）
  await expect(page.getByRole('button', { name: '修正' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '追記' })).toHaveCount(0);
  await page.screenshot({ path: 'tests/shot-driver-board.png', fullPage: true });

  // 「記録」に戻れば、いつもの操作ができる
  await page.getByRole('button', { name: '記録' }).click();
  await expect(page.getByTestId('enroute')).toContainText('運行中');
});

test('0.00 以外の値と、対面以外の確認方法も記録できる', async ({ page }) => {
  await unlock(page);
  await page.getByTestId('alc-detail-運転前').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  await dialog.getByLabel('検知器の表示').fill('0.15');
  await dialog.getByLabel('確認方法').selectOption('写真送付');
  await dialog.getByLabel('備考').fill('自宅から出発のため写真で確認');

  // 検知器の表示を撮った写真も付けられる（縮めてから保存する）
  await dialog.getByLabel('写真（任意）').setInputFiles({
    name: 'meter.png', mimeType: 'image/png',
    // 検証用の小さな画像
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGM4oaGBFTEMLQkAgl1GAWqNFmsAAAAASUVORK5CYII=', 'base64'),
  });
  await expect(dialog.locator('.photo-state')).toContainText('写真を添付しました');
  await dialog.getByRole('button', { name: '保存する' }).click();

  // 値と確認方法が記録に残る
  await expect(page.getByTestId('alc-運転前')).toContainText('⚠ 0.15');
  await expect(page.getByTestId('alc-運転前')).toContainText('写真送付');
  await expect(page.getByTestId('alc-運転前')).toContainText('📷');

  // 検出されているあいだは出発できない
  await expect(page.getByTestId('today')).toContainText('アルコールが検出されています');
  await expect(page.getByTestId('depart')).toBeDisabled();
  await page.screenshot({ path: 'tests/shot-detected.png', fullPage: true });

  // 入力を間違えた場合は取り消してやり直せる
  await page.getByRole('button', { name: '取消' }).click();
  await page.getByTestId('alc-record-運転前').click();
  await expect(page.getByTestId('depart')).toBeEnabled();
});
