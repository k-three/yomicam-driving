import { test, expect, type Page } from '@playwright/test';

/** 虎の巻から「🚨 緊急」を出す。虎の巻の代わりのページ（tests/fixtures/toranomaki.html）は、
 *  緊急の画面を壊しそうな CSS をわざと入れてある。それでも使えることを確かめる。
 *  ?mock=1 で本物の Firebase には触らない。 */
const PAGE = 'tests/fixtures/toranomaki.html?mock=1';

async function login(page: Page) {
  await page.getByTestId('tora-sos').click();
  // 送迎記録と同じパスワードを、この端末で最初の1回だけ聞く
  await page.getByTestId('pw').fill('mock');
  await page.getByTestId('login').click();
}

test('虎の巻から緊急を出すと帯が出て、帯から解決できる', async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.locator('#yomicam-alert')).toHaveCount(0);
  await login(page);

  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('何が起きた？');
  // 虎の巻の CSS（.big を消す・button を崩す）が効いていない
  await expect(dialog.getByTestId('raise')).toBeVisible();
  await expect(dialog.getByTestId('call')).toHaveAttribute('href', 'tel:090-0000-0001');

  // 誰が押したかを虎の巻は知らないので、名前を聞く
  await dialog.getByTestId('who').fill('はあと');
  await dialog.getByTestId('kind-所在不明').click();
  // 送迎以外の場面が多いので、場所は拠点が先
  await expect(dialog.locator('[name=place] option').first()).toHaveText('読谷村文化センター');
  await dialog.getByRole('button', { name: /まいら/ }).click();
  await dialog.getByPlaceholder(/拠点で姿が見えない/).fill('トイレから戻らない');
  await page.screenshot({ path: 'tests/shot-tora-sos.png', fullPage: true });
  page.once('dialog', d => d.accept());
  await dialog.getByTestId('raise').click();

  // 虎の巻の帯がすぐ出る（次の確認を待たない）
  const banner = page.locator('#yomicam-alert');
  await expect(banner).toContainText('🚨 緊急対応中：所在不明');
  await page.screenshot({ path: 'tests/shot-tora-banner.png' });

  // 帯の「対応・解決」から、同じ画面で解決できる（もうパスワードは聞かれない）
  await banner.getByRole('button', { name: '対応・解決' }).click();
  const d2 = page.getByRole('dialog');
  await expect(d2).toContainText('緊急対応中：所在不明');
  await expect(d2).toContainText('はあと');
  await expect(d2).toContainText('来ていない：まいら');
  // 閉じる人の名前は前回のものが入っている
  await expect(d2.getByTestId('who')).toHaveValue('はあと');
  await d2.getByTestId('resolve').click();
  await expect(banner).toHaveCount(0);
});

test('名前を入れなくても出せる（初動を止めない）。ケガなら 119 が先に出る', async ({ page }) => {
  await page.goto(PAGE);
  await login(page);
  const dialog = page.getByRole('dialog');
  await dialog.getByTestId('kind-ケガ').click();
  await expect(dialog.getByTestId('dial-119')).toHaveAttribute('href', 'tel:119');
  await expect(dialog).toContainText('ケガをした児童');
  page.once('dialog', d => d.accept());
  await dialog.getByTestId('raise').click();
  await expect(page.locator('#yomicam-alert')).toContainText('緊急対応中：ケガ');
  await page.locator('#yomicam-alert').getByRole('button', { name: '対応・解決' }).click();
  await expect(page.getByRole('dialog')).toContainText('虎の巻（名前未入力）');
});

test('パスワードが違えば入れない。閉じれば何も起きない', async ({ page }) => {
  await page.goto(PAGE);
  await page.getByTestId('tora-sos').click();
  await page.getByTestId('pw').fill('ちがう');
  await page.getByTestId('login').click();
  await expect(page.getByTestId('pw-error')).toHaveText('パスワードが違います');
  await page.getByRole('button', { name: '閉じる' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('#yomicam-alert')).toHaveCount(0);
});
