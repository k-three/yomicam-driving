/** 管理者向けの進捗ダッシュボード。運転手アプリとは別の入口・別の権限で開く。 */
import type { Board } from '../domain/status';
import type { AlcoholCheck } from '../domain/types';
import { riderAliases, totalCount } from '../domain/reports';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** アルコールチェックの1マス。記録があれば押して直せるようにし、無ければ追記させる。
 *  警告を出している場所と、直す場所を離さないための作り。 */
const cell = (rec: AlcoholCheck | undefined, driver: string, kind: string, editable: boolean) => {
  if (!rec) return editable
    ? `<span class="none">—</span>
       <button class="mini" data-add-alc="${esc(driver)}|${esc(kind)}">追記</button>`
    : '—';
  // 写真は押したときだけ読み込む（一覧を開くたびに画像まで取りに行かない）
  const pic = rec.photo
    ? `<button class="mini" data-photo="${esc(rec.id)}" title="写真を見る">📷</button>` : '';
  const body = `${esc(rec.at)}　${esc(rec.result)}`;
  return (editable
    ? `<button class="mini rec" data-fix-alc="${esc(rec.id)}">${body}</button>`
    : body) + pic;
};

const table = (head: string[], rows: string[], empty: string) =>
  `<div class="tablewrap">${rows.length
    ? `<table><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`
    : `<table><tbody><tr><td class="empty">${empty}</td></tr></tbody></table>`}</div>`;

export type BoardView = {
  /** false にすると、直す導線を出さない見るだけの表示になる（運転手アプリ） */
  editable?: boolean;
  /** false は過去の日を見ている状態。「本日」と言わず、現在時刻も出さない */
  live?: boolean;
};

export function renderBoard(b: Board, day: string, nowHm: string, opts: BoardView = {}): string {
  const { editable = true, live = true } = opts;
  const act = (html: string) => (editable ? html : '');
  // 見出しの言い回しは、見ている日によって変える（過去の日に「本日」は嘘になる）
  const of = live ? '本日' : 'この日';
  return `
<div class="board-head">
  <h1>運行状況</h1>
  <span class="pill ${b.alerts ? 'ng' : 'ok'}" data-testid="alerts">${
    b.alerts ? `⚠ 要確認 ${b.alerts}件` : '✓ 異常なし'}</span>
  <span class="when" data-testid="board-when">${esc(day)}${live ? `　最終更新 ${esc(nowHm)}` : ''}</span>
</div>

<section><h2>${of}の完了運行（${b.done.length}件）</h2>
${table(['時間帯', '車両', '運転者', '乗せた児童', '到着場所', '経由・備考', ...(editable ? [''] : [])],
  b.done.map(t => `<tr data-testid="done-row">
    <td class="num">${esc(t.departAt)}〜${esc(t.returnAt || '（未記録）')}</td>
    <td class="name">${esc(t.vehicle)}</td><td class="name">${esc(t.driver)}</td>
    <td>${esc(riderAliases(t) || `${totalCount(t)}人`)}</td>
    <td>${esc(t.dest)}</td>
    <td>${esc(t.stops.map(s => `${s.school} ${s.arriveAt}→${s.departAt}（${s.count}人）`).join(' ／ '))}${
      t.note ? `　${esc(t.note)}` : ''}</td>
    ${act(`<td><button class="mini" data-fix-trip="${esc(t.id)}">修正</button></td>`)}</tr>`),
  'まだありません')}
</section>

<section><h2>${of}のアルコールチェック</h2>
${table(['運転者', '運転前', '運転後', '状態'],
  b.alcohol.map(a => `<tr class="${a.ng ? 'alert' : ''}" data-testid="alcohol-row">
    <td class="name">${esc(a.driver)}</td>
    <td class="num">${cell(a.pre, a.driver, '運転前', editable)}</td>
    <td class="num">${cell(a.post, a.driver, '運転後', editable)}</td>
    <td class="${a.ng ? 'worry' : ''}">${esc(a.state)}</td></tr>`),
  'まだありません')}
${act('<p class="note">時刻をタップすると直せます。記録が無いところは「追記」から足せます。</p>')}
</section>

<section><h2>${of}の動き（新しい順・全車両）</h2>
${table(['時刻', '車両', 'できごと', '場所・学校', '人数'],
  b.events.slice(0, 30).map(e => `<tr>
    <td class="num">${esc(e.at)}</td><td class="name">${esc(e.vehicle)}</td><td>${esc(e.what)}</td>
    <td>${esc(e.place)}</td><td class="num">${e.count}</td></tr>`),
  'まだありません')}
</section>`;
}
