/** 運行管理担当が「順調か・異常はないか」をひと目で掴むための現況。
 *  追記型のログではなく、いまの記録から毎回組み立てる派生ビューなので、
 *  取り消し・リセット・修正はそのまま反映され、消えたものは残らない。 */
import type { AlcoholCheck, Trip } from './types';
import { elapsed, hm, isAfter, normResult, toMin } from './time';
import { totalCount } from './reports';

export type RunningRow = {
  trip: Trip; elapsedMin: number; place: string; onboard: number; worries: string[];
};
export type AlcoholRow = { driver: string; pre?: AlcoholCheck; post?: AlcoholCheck; state: string; ng: boolean };
export type Event = { at: string; vehicle: string; what: string; place: string; count: number | '' };

/** 車両1台ぶんの本日のすべて。時系列の帯と現在地を、車両ごとに1行で見せるための単位。
 *  同じ車両が1日に何回運行しても1行にまとまる。 */
export type Lane = {
  vehicle: string;
  driver: string;          // 直近の運転者
  trips: Trip[];           // 本日その車両で走ったぶん（運行中を含む・出発順）
  running: boolean;
  /** いまどこにいるか。運行中なら現在地、終わっていれば帰着した場所と時刻 */
  place: string;
  elapsedMin: number;      // 運行中の経過。終わっていれば直近の運行の所要
  onboard: number;
  worries: string[];
};

export type Board = {
  lanes: Lane[];
  running: RunningRow[];
  done: Trip[];
  alcohol: AlcoholRow[];
  events: Event[];
  alerts: number;
};

export function buildBoard(
  trips: Trip[], checks: AlcoholCheck[], nowHm: string,
  threshold: { stayMin: number; tripMin: number },
): Board {
  const running = trips.filter(t => t.status === 'running')
    .sort((a, b) => (a.departAt < b.departAt ? -1 : 1))
    .map<RunningRow>(t => {
      const last = t.stops[t.stops.length - 1];
      const open = last && !last.departAt ? last : undefined;
      const worries: string[] = [];
      let place: string;
      if (open) {
        const stay = elapsed(open.arriveAt, nowHm);
        place = `${open.school}（${open.arriveAt} 到着・滞在${stay}分）`;
        if (stay > threshold.stayMin)
          worries.push(`学校での滞在が${stay}分。乗車の記録漏れか、何か起きている可能性`);
      } else if (last) {
        place = `${last.school} を ${last.departAt} 発（移動中）`;
      } else {
        place = `${t.base} を ${t.departAt} 発（学校へ移動中）`;
      }
      const elapsedMin = elapsed(t.departAt, nowHm);
      if (elapsedMin > threshold.tripMin)
        worries.push(`運行開始から${hm(elapsedMin)}。終了の押し忘れの可能性`);
      if (!checks.some(c => c.kind === '運転前' && c.driver === t.driver))
        worries.push('運転前アルコールチェックが未記録');
      return { trip: t, elapsedMin, place, onboard: totalCount(t), worries };
    });

  const done = trips.filter(t => t.status === 'done')
    .sort((a, b) => (a.departAt < b.departAt ? -1 : 1));

  const drivers = [...new Set([...running.map(r => r.trip.driver), ...done.map(t => t.driver), ...checks.map(c => c.driver)])];
  const pick = (kind: AlcoholCheck['kind'], d: string) => checks.filter(c => c.kind === kind && c.driver === d).slice(-1)[0];
  const alcohol = drivers.map<AlcoholRow>(driver => {
    const pre = pick('運転前', driver), post = pick('運転後', driver);
    const stillRunning = running.some(r => r.trip.driver === driver);
    const mine = done.filter(t => t.driver === driver);
    const drove = mine.length > 0;
    // 運転後を記録したあとにもう1度運転した場合。記録し直さないと記録簿が実態と合わない
    const lastBack = mine.map(t => t.returnAt).filter(Boolean).sort().slice(-1)[0] ?? '';
    const staleP = !!post && !!lastBack && isAfter(lastBack, post.at);
    let state = '✓ 記録済み', ng = false;
    if (!pre) { state = '⚠ 運転前が未記録'; ng = true; }
    else if (normResult(pre.result) !== '0.00') { state = '⚠ 検出あり。運行させないこと'; ng = true; }
    else if (stillRunning) state = '運行中（運転後は帰着後）';
    // 運転前・運転後がそろっているのに運行が1件も無い。運行の削除や試し入力で起きる。
    // アルコールの記録は運行に紐づかない独立した記録なので、自動では消さずここで知らせる
    else if (!drove && post) { state = '⚠ 運行の記録がないのにチェックだけある'; ng = true; }
    else if (!drove) state = '運転前のみ記録（まだ運行なし）';
    else if (!post) { state = '⚠ 運転後が未記録'; ng = true; }
    else if (staleP) {
      state = `⚠ 運転後（${post.at}）が最後の運行（${lastBack} 帰着）より前。記録し直しが必要`;
      ng = true;
    }
    return { driver, pre, post, state, ng };
  });

  const events: Event[] = [];
  const push = (at: string, vehicle: string, what: string, place = '', count: number | '' = '') => {
    if (at) events.push({ at, vehicle, what, place, count });
  };
  for (const t of trips) {
    push(t.departAt, t.vehicle, '出発', t.base);
    for (const s of t.stops) {
      push(s.arriveAt, t.vehicle, '学校に到着', s.school);
      if (s.departAt) push(s.departAt, t.vehicle, s.count > 0 ? `${s.count}名 乗せて出発` : '乗車なしで出発', s.school, s.count);
    }
    if (t.status === 'done') push(t.returnAt, t.vehicle, '拠点に到着（運行終了）', t.dest, totalCount(t));
  }
  // 新しい順。文字列ではなく分に直して比べる（'9:05' と '09:05' が混ざっても崩れない）
  events.sort((a, b) => (toMin(b.at) ?? 0) - (toMin(a.at) ?? 0));

  // 車両ごとに1行へまとめる。同じ車両が1日に何回走っても1行。
  const byVehicle = new Map<string, Trip[]>();
  for (const t of [...trips].sort((a, b) => (a.departAt < b.departAt ? -1 : 1)))
    byVehicle.set(t.vehicle, [...(byVehicle.get(t.vehicle) ?? []), t]);

  const lanes: Lane[] = [...byVehicle.entries()].map(([vehicle, list]) => {
    const run = running.find(r => r.trip.vehicle === vehicle);
    const last = list[list.length - 1]!;
    if (run) return {
      vehicle, driver: run.trip.driver, trips: list, running: true,
      place: run.place, elapsedMin: run.elapsedMin, onboard: run.onboard, worries: run.worries,
    };
    return {
      vehicle, driver: last.driver, trips: list, running: false,
      place: `${last.dest || '拠点'} に ${last.returnAt || '（未記録）'} 帰着`,
      elapsedMin: elapsed(last.departAt, last.returnAt),
      onboard: totalCount(last), worries: [],
    };
  }).sort((a, b) => (a.running === b.running ? 0 : a.running ? -1 : 1));

  const alerts = running.filter(r => r.worries.length).length + alcohol.filter(a => a.ng).length;
  return { lanes, running, done, alcohol, events, alerts };
}
