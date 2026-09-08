/** 車両ごとの動きを時系列の帯で見せる。表を読まなくても、
 *  「いまどこにいて、どんな動きだったか」が一目で分かることを狙う。
 *  色は3状態の識別用（検証済み：CVD・normal・コントラストすべて通過）。
 *  要確認は status 色＋記号＋文言で示し、色だけに頼らない。 */
import type { Trip } from '../domain/types';
import { tripSpans, timeWindow, SPAN_LABEL, type SpanKind } from '../domain/timeline';
import { toMin } from '../domain/time';
import { totalCount } from '../domain/reports';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const clock = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export type TimelineRow = { trip: Trip; worries: string[] };

export function renderTimeline(rows: TimelineRow[], nowHm: string): string {
  const trips = rows.map(r => r.trip);
  const { start, end } = timeWindow(trips, nowHm);
  const span = end - start;
  const pct = (m: number) => ((m - start) / span) * 100;
  const now = toMin(nowHm) ?? start;

  const ticks: string[] = [];
  for (let m = Math.ceil(start / 60) * 60; m <= end; m += 60)
    ticks.push(`<span class="tl-tick" style="left:${pct(m)}%">${clock(m)}</span>`);

  const legend = (['onboard', 'wait', 'ferry'] as SpanKind[])
    .map(k => `<span class="lg"><i class="sw ${k}"></i>${SPAN_LABEL[k]}</span>`).join('');

  if (!rows.length)
    return `<section class="timeline"><h2>いまの動き</h2>
      <p class="empty-tl">本日の運行はまだありません。</p></section>`;

  const body = rows.map(({ trip, worries }) => {
    const spans = tripSpans(trip, nowHm).map(s => {
      const a = toMin(s.from), b = toMin(s.to);
      if (a === null || b === null || b <= a) return '';
      const w = pct(b) - pct(a);
      const text = w >= 9 ? esc(s.label) : '';
      return `<div class="sp ${s.kind}${s.live ? ' live' : ''}" style="left:${pct(a)}%;width:calc(${w}% - 2px)"
        data-tip="${esc(s.detail)}"><span>${text}</span></div>`;
    }).join('');
    const alert = worries.length > 0;
    return `<div class="tl-row${alert ? ' alert' : ''}" data-testid="tl-row">
      <div class="tl-label">
        <b>${esc(trip.vehicle)}</b>
        <small>${esc(trip.driver)}${totalCount(trip) ? `・乗車${totalCount(trip)}人` : ''}</small>
        ${alert ? `<em class="tl-warn">⚠ 要確認</em>` : ''}
      </div>
      <div class="tl-track">${spans}<div class="tl-now" style="left:${pct(now)}%"></div></div>
    </div>`;
  }).join('');

  return `<section class="timeline">
    <h2>いまの動き<span class="legend">${legend}</span></h2>
    <div class="tl">
      <div class="tl-row tl-axis"><div class="tl-label"></div><div class="tl-track">${ticks.join('')}
        <div class="tl-now" style="left:${pct(now)}%"><span>現在 ${esc(nowHm)}</span></div></div></div>
      ${body}
    </div>
    <p class="tl-note">帯の区切りは、保険会社へ提出する輸送記録の区間と同じ考え方です。帯にカーソルを合わせると詳細が出ます。</p>
  </section>`;
}

/** 帯にカーソルを合わせたときの説明。画面ごとに1つ用意する */
export function attachTooltip(root: HTMLElement) {
  const tip = document.createElement('div');
  tip.className = 'tl-tip';
  document.body.appendChild(tip);
  root.addEventListener('mouseover', e => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-tip]');
    if (!el) return;
    tip.textContent = el.dataset.tip!;
    const r = el.getBoundingClientRect();
    tip.style.left = `${Math.max(8, r.left + r.width / 2)}px`;
    tip.style.top = `${r.top + window.scrollY - 8}px`;
    tip.classList.add('show');
  });
  root.addEventListener('mouseout', e => {
    if ((e.target as HTMLElement).closest('[data-tip]')) tip.classList.remove('show');
  });
}
