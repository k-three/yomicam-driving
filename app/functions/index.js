/** 緊急対応を Slack（#安全-緊急）へ自動で投稿する。
 *
 *  送迎記録アプリの「🚨 緊急」は Firestore の incidents に1件書くだけで、
 *  Slack への投稿はここ（サーバー側）が受け持つ。こうしておくと
 *    - Slack の投稿先 URL（秘密）を公開サイトに置かずに済む
 *    - 押した人の電波が弱くても、記録がサーバーに届いた時点で必ず投稿される
 *  結果は文書の slack 欄に書き戻し、アプリの赤い帯に「投稿済み／できなかった」を出す。
 *
 *  投稿先 URL は Secret Manager の SLACK_WEBHOOK_URL に置く（このリポジトリには無い）。 */
import { initializeApp } from 'firebase-admin/app';
import { FieldValue } from 'firebase-admin/firestore';
import { setGlobalOptions } from 'firebase-functions/v2';
import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { defineSecret, defineString } from 'firebase-functions/params';
import { logger } from 'firebase-functions';
import { closeText, isAllowedWebhook, raiseText } from './message.js';

initializeApp();

const SLACK_WEBHOOK_URL = defineSecret('SLACK_WEBHOOK_URL');
/** Firestore の場所に合わせる（違うと動かない）。deploy.sh が自動で調べて functions/.env に書く */
const LOCATION = defineString('LOCATION', { default: 'asia-northeast1' });

// 緊急のときにしか動かないので、待機させる台数は0（費用をかけない）。
// 起動に数秒かかることがあるが、電話が先なので許容する
setGlobalOptions({ region: LOCATION, maxInstances: 2 });

const emulator = process.env.FUNCTIONS_EMULATOR === 'true';

/** Slack に投稿し、結果を返す。例外は投げない（失敗も記録として残すため） */
async function post(text) {
  const url = SLACK_WEBHOOK_URL.value().trim();
  if (!isAllowedWebhook(url, emulator))
    return { ok: false, error: 'SLACK_WEBHOOK_URL が Slack の Webhook の形になっていません' };
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (r.ok) return { ok: true, error: '' };
    return { ok: false, error: `Slack が ${r.status} を返しました：${(await r.text()).slice(0, 120)}` };
  } catch (e) {
    return { ok: false, error: `Slack に届きませんでした：${String(e?.message ?? e).slice(0, 120)}` };
  }
}

/** 緊急対応が立ったら、一報を投稿する */
export const slackOnIncidentRaised = onDocumentCreated(
  { document: 'incidents/{id}', secrets: [SLACK_WEBHOOK_URL] },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const inc = snap.data();
    // 同じ通知が2度来ることがある（Firestore のトリガーは「少なくとも1回」）。二重投稿を避ける
    if (inc.slack?.raised) return;
    if (inc.status !== 'open') return;
    const res = await post(raiseText(inc));
    if (!res.ok) logger.error('緊急の一報を Slack に投稿できませんでした', { id: event.params.id, error: res.error });
    await snap.ref.update({
      slack: { raised: res.ok, ok: res.ok, error: res.error, at: FieldValue.serverTimestamp() },
    });
  },
);

/** 解決・取り消しになったら、お知らせを投稿する。
 *  上の関数が slack 欄を書き戻したときにもここが呼ばれるので、状態が
 *  「開いている → 閉じた」に変わったときだけ動く */
export const slackOnIncidentClosed = onDocumentUpdated(
  { document: 'incidents/{id}', secrets: [SLACK_WEBHOOK_URL] },
  async (event) => {
    const before = event.data?.before.data(), after = event.data?.after.data();
    if (!before || !after) return;
    if (!(before.status === 'open' && after.status === 'closed')) return;
    if (after.slack?.closed) return;
    const res = await post(closeText(after));
    if (!res.ok) logger.error('解決のお知らせを Slack に投稿できませんでした', { id: event.params.id, error: res.error });
    await event.data.after.ref.update({
      'slack.closed': res.ok, 'slack.closeError': res.error, 'slack.closedAt': FieldValue.serverTimestamp(),
    });
  },
);
