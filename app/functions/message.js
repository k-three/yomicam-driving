/** Slack に送る文面。Firebase に依存しない純粋な関数にして、単体で確かめられるようにする。
 *
 *  入力（incidents の文書）は運転手・管理者が書いたものなので、そのまま信用しない。
 *  Slack の書式で特別な意味を持つ & < > を逃がし、<!everyone> のような
 *  一斉通知を文中に仕込めないようにする。 */

export const APP_URL = 'https://k-three.github.io/yomicam-driving/admin.html';

/** この時間を超えて届いたら「遅れて届いた」と書く（電波の弱い場所で押したとき） */
const LATE_MS = 3 * 60_000;

export const slackEscape = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const minutes = (ms) => {
  const m = Math.max(0, Math.round(ms / 60_000));
  return m < 60 ? `${m}分` : `${Math.floor(m / 60)}時間${m % 60}分`;
};

/** 緊急対応を立てたときの一報 */
export function raiseText(inc, nowMs = Date.now()) {
  const e = slackEscape;
  const lines = [
    `<!channel> 🚨 *緊急対応中*（${e(inc.startedAt)}〜）`,
    `場所：${e(inc.place) || '（未入力）'}`,
    `${e(inc.driver) || '（不明）'}${inc.vehicle ? `／車両：${e(inc.vehicle)}` : ''}`,
  ];
  if (Array.isArray(inc.riders) && inc.riders.length)
    lines.push(`来ていない・所在不明：*${inc.riders.map(e).join('・')}*`);
  if (inc.note) lines.push(`状況：${e(inc.note)}`);
  const late = nowMs - Number(inc.startedMs || nowMs);
  if (late > LATE_MS)
    lines.push(`_※電波の状況で、押してから${minutes(late)}遅れて届きました_`);
  lines.push(`対応できる人はこのチャンネルで返信してください。詳細・電話先：<${APP_URL}|送迎記録>`);
  return lines.join('\n');
}

/** 解決・取り消しのお知らせ */
export function closeText(inc) {
  const e = slackEscape;
  const head = inc.outcome === 'cancelled'
    ? `↩️ *誤報として取り消し*（${e(inc.closedAt)}・${e(inc.closedBy)}）`
    : `✅ *解決*（${e(inc.closedAt)}・${e(inc.closedBy)}）`;
  const took = inc.closedMs && inc.startedMs ? `　対応時間 ${minutes(inc.closedMs - inc.startedMs)}` : '';
  const lines = [head, `${e(inc.startedAt)} に出た緊急対応（${e(inc.place) || '場所未入力'}）${took}`];
  if (inc.closedNote) lines.push(`内容：${e(inc.closedNote)}`);
  return lines.join('\n');
}

/** 送り先として受け付ける URL。本番は Slack の Incoming Webhook だけ。
 *  エミュレータでの試験に限り、手元のサーバーを許す */
export function isAllowedWebhook(url, emulator = false) {
  if (/^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+$/.test(url)) return true;
  return emulator && /^http:\/\/127\.0\.0\.1:\d+\//.test(url);
}
