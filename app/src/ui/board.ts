/** 管理者向けの進捗ダッシュボード。運転手アプリとは別の入口・別の権限で開く。 */
import type { Board } from '../domain/status';
import { hm } from '../domain/time';
import { totalCount } from '../domain/reports';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

const table = (head: string[], rows: string[], empty: string) =>
  `<div class="tablewrap">${rows.length
    ? `<table><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`
    : `<table><tbody><tr><td class="empty">${empty}</td></tr></tbody></table>`}</div>`;

export function renderBoard(b: Board, today: string, nowHm: string): string {
  return `
<div class="board-head">
  <h1>運行状況</h1>
  <span class="pill ${b.alerts ? 'ng' : 'ok'}" data-testid="alerts">${
    b.alerts ? `⚠ 要確認 ${b.alerts}件` : '✓ 異常なし'}</span>
  <span class="when">${esc(today)}　最終更新 ${esc(nowHm)}</span>
</div>

<section><h2>いま動いている車両（${b.running.length}台）</h2>
${table(['状態', '車両', '運転者', '出発', '経過', '現在地', '乗車', '気になる点'],
  b.running.map(r => `<tr class="${r.worries.length ? 'alert' : ''}" data-testid="running-row">
    <td class="name">${r.worries.length ? '⚠ 要確認' : '🚐 運行中'}</td>
    <td class="name">${esc(r.trip.vehicle)}</td><td class="name">${esc(r.trip.driver)}</td>
    <td class="num">${esc(r.trip.departAt)}</td><td class="num">${hm(r.elapsedMin)}</td>
    <td>${esc(r.place)}</td><td class="num">${r.onboard}</td>
    <td class="${r.worries.length ? 'worry' : ''}">${esc(r.worries.join(' ／ '))}</td></tr>`),
  '運行中の車両はありません')}
</section>

<section><h2>本日の完了運行（${b.done.length}件）</h2>
${table(['時間帯', '車両', '運転者', '乗車', '到着場所', '経由・備考'],
  b.done.map(t => `<tr data-testid="done-row">
    <td class="num">${esc(t.departAt)}〜${esc(t.returnAt || '（未記録）')}</td>
    <td class="name">${esc(t.vehicle)}</td><td class="name">${esc(t.driver)}</td><td class="num">${totalCount(t)}</td>
    <td>${esc(t.dest)}</td>
    <td>${esc(t.stops.map(s => `${s.school} ${s.arriveAt}→${s.departAt}（${s.count}人）`).join(' ／ '))}${
      t.note ? `　${esc(t.note)}` : ''}</td></tr>`),
  'まだありません')}
</section>

<section><h2>本日のアルコールチェック</h2>
${table(['運転者', '運転前', '運転後', '状態'],
  b.alcohol.map(a => `<tr class="${a.ng ? 'alert' : ''}" data-testid="alcohol-row">
    <td class="name">${esc(a.driver)}</td>
    <td class="num">${a.pre ? `${esc(a.pre.at)}　${esc(a.pre.result)}` : '—'}</td>
    <td class="num">${a.post ? `${esc(a.post.at)}　${esc(a.post.result)}` : '—'}</td>
    <td class="${a.ng ? 'worry' : ''}">${esc(a.state)}</td></tr>`),
  'まだありません')}
</section>

<section><h2>本日の動き（新しい順・全車両）</h2>
${table(['時刻', '車両', 'できごと', '場所・学校', '人数'],
  b.events.slice(0, 30).map(e => `<tr>
    <td class="num">${esc(e.at)}</td><td class="name">${esc(e.vehicle)}</td><td>${esc(e.what)}</td>
    <td>${esc(e.place)}</td><td class="num">${e.count}</td></tr>`),
  'まだありません')}
</section>`;
}
