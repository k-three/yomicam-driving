/** 車両ごとの動きを時系列の帯に変換する。
 *  区間の切り方は保険提出用の輸送記録と同じ考え方（回送・学校待機・乗車）に
 *  そろえてあるので、画面で見た動きと提出する帳票がずれない。 */
import type { Trip } from './types';
import { toMin } from './time';

export type SpanKind = 'ferry' | 'wait' | 'onboard';

export type Span = {
  kind: SpanKind;
  from: string;
  to: string;
  /** 帯の中に出す短い名前 */
  label: string;
  /** ホバーで出す説明 */
  detail: string;
  /** まだ終わっていない区間（右端が現在時刻） */
  live: boolean;
};

export const SPAN_LABEL: Record<SpanKind, string> = {
  ferry: '回送（空車で移動）',
  wait: '学校で待機',
  onboard: '児童を乗せて移動',
};

export function tripSpans(t: Trip, nowHm: string): Span[] {
  const spans: Span[] = [];
  const running = t.status === 'running';
  let place = t.base, at = t.departAt, onboard = 0;

  for (const s of t.stops) {
    const kind: SpanKind = onboard > 0 ? 'onboard' : 'ferry';
    spans.push({ kind, from: at, to: s.arriveAt, label: s.school, live: false,
      detail: `${at}→${s.arriveAt}　${place} → ${s.school}${onboard ? `（児童${onboard}名）` : '（空車）'}` });

    const open = !s.departAt;
    const end = open ? (running ? nowHm : s.arriveAt) : s.departAt;
    if (end !== s.arriveAt)
      spans.push({ kind: 'wait', from: s.arriveAt, to: end, label: s.school, live: open,
        detail: `${s.arriveAt}→${open ? '（滞在中）' : s.departAt}　${s.school}で待機` });
    if (open) return spans;   // 学校に滞在中。ここから先はまだ起きていない

    onboard += s.count;
    place = s.school; at = s.departAt;
  }

  const end = t.returnAt || (running ? nowHm : at);
  const kind: SpanKind = onboard > 0 ? 'onboard' : 'ferry';
  spans.push({ kind, from: at, to: end, label: t.dest || '拠点', live: !t.returnAt,
    detail: `${at}→${t.returnAt || '（移動中）'}　${place} → ${t.dest || '拠点'}${onboard ? `（児童${onboard}名）` : '（空車）'}` });
  return spans;
}

/** 表示する時間帯。運行の範囲に現在時刻を含め、前後に少し余白を取る */
export function timeWindow(trips: Trip[], nowHm: string): { start: number; end: number } {
  const now = toMin(nowHm) ?? 12 * 60;
  const times = trips.flatMap(t => [toMin(t.departAt), toMin(t.returnAt)]).filter((n): n is number => n !== null);
  const lo = Math.min(now, ...times.length ? times : [now]);
  const hi = Math.max(now, ...times.length ? times : [now]);
  const start = Math.max(0, Math.floor((lo - 20) / 30) * 30);
  const end = Math.min(24 * 60, Math.ceil((hi + 20) / 30) * 30);
  return { start, end: Math.max(end, start + 60) };
}
