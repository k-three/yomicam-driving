/** 車両ごとの動きを時系列の帯に変換する。
 *  区間の切り方は保険提出用の輸送記録と同じ考え方（回送・学校待機・乗車）に
 *  そろえてあるので、画面で見た動きと提出する帳票がずれない。 */
import type { Rider, Trip } from './types';
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

/** 乗っている児童。ふだんの画面なので呼び名で出す（報告書は正式な氏名） */
const riding = (riders: Rider[], n: number) =>
  riders.length ? riders.map(r => r.alias).join('・') : n ? `児童${n}名` : '';

export function tripSpans(t: Trip, nowHm: string): Span[] {
  const spans: Span[] = [];
  const running = t.status === 'running';
  let place = t.base, at = t.departAt, onboard = 0;
  let riders: Rider[] = [];

  for (const s of t.stops) {
    const kind: SpanKind = onboard > 0 ? 'onboard' : 'ferry';
    const who = riding(riders, onboard);
    spans.push({ kind, from: at, to: s.arriveAt, label: s.school, live: false,
      detail: `${at}→${s.arriveAt}　${place} → ${s.school}${who ? `（${who}）` : '（空車）'}` });

    const open = !s.departAt;
    const end = open ? (running ? nowHm : s.arriveAt) : s.departAt;
    if (end !== s.arriveAt)
      spans.push({ kind: 'wait', from: s.arriveAt, to: end, label: s.school, live: open,
        detail: `${s.arriveAt}→${open ? '（滞在中）' : s.departAt}　${s.school}で待機` });
    if (open) return spans;   // 学校に滞在中。ここから先はまだ起きていない

    onboard += s.count;
    riders = [...riders, ...(s.riders ?? [])];
    place = s.school; at = s.departAt;
  }

  const end = t.returnAt || (running ? nowHm : at);
  const kind: SpanKind = onboard > 0 ? 'onboard' : 'ferry';
  const who = riding(riders, onboard);
  spans.push({ kind, from: at, to: end, label: who || t.dest || '拠点', live: !t.returnAt,
    detail: `${at}→${t.returnAt || '（移動中）'}　${place} → ${t.dest || '拠点'}${who ? `（${who}）` : '（空車）'}` });
  return spans;
}

/** 表示する時間帯。運行の範囲に現在時刻を含め、前後に少し余白を取る。
 *  nowHm が空のとき（過去の日を見ていて現在時刻に意味が無いとき）は、
 *  その日の記録だけで幅を決める */
export function timeWindow(trips: Trip[], nowHm: string): { start: number; end: number } {
  const now = toMin(nowHm);
  const times = trips.flatMap(t => [toMin(t.departAt), toMin(t.returnAt)]).filter((n): n is number => n !== null);
  const marks = now === null ? times : [now, ...times];
  const base = marks.length ? marks : [12 * 60];
  const lo = Math.min(...base);
  const hi = Math.max(...base);
  const start = Math.max(0, Math.floor((lo - 20) / 30) * 30);
  const end = Math.min(24 * 60, Math.ceil((hi + 20) / 30) * 30);
  return { start, end: Math.max(end, start + 60) };
}
