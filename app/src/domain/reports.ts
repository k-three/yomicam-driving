/** 月次帳票の集計。Apps Script 版で運用・検証してきたロジックをそのまま移植する。
 *  保険会社ひな形の区間分割、待機の扱い、運転者単位の1日通算、保険料区分は
 *  提出物の根拠になるため、挙動を変えないこと。 */
import type { Trip, AlcoholCheck, Config, Finding, Day } from './types';
import { elapsed, hm, normResult, toMin, isAfter } from './time';

export const BRACKETS = [
  '1時間以内', '1時間超2時間以内', '2時間超3時間以内', '3時間超4時間以内', '4時間超5時間以内',
  '5時間超6時間以内', '6時間超7時間以内', '7時間超8時間以内', '8時間超9時間以内', '9時間超24時間以内',
] as const;

/** 提供時間（分）から保険料の時間区分へ。1時間未満も「1時間以内」に入る */
export function bracketIndex(min: number): number {
  const h = Math.max(1, Math.ceil(min / 60));
  return h <= 9 ? h - 1 : 9;
}

const inMonth = (d: Day, ym: string) => d.slice(0, 7) === ym;
const passengers = (n: number) => (n > 0 ? `児童${n}名` : '待機');
export const totalCount = (t: Trip) => t.stops.reduce((s, x) => s + x.count, 0);

export type Segment = {
  driver: string; regno: string; users: string;
  from: string; to: string;
  startDay: Day; startAt: string; endDay: Day; endAt: string;
  duration: string; note: string;
};

export type InsuranceReport = {
  counts: number[];
  segments: Segment[];
  daily: { date: Day; driver: string; total: string; bracket: string }[];
};

/** 保険会社へ毎月通知する輸送記録 */
export function buildInsuranceReport(trips: Trip[], config: Config, ym: string): InsuranceReport {
  const regnoOf = new Map(config.vehicles.map(v => [v.name, v.regno]));
  const target = trips
    .filter(t => t.status === 'done' && inMonth(t.date, ym))
    .sort((a, b) => (a.date + a.departAt < b.date + b.departAt ? -1 : 1));

  const segments: Segment[] = [];
  const dailyMin = new Map<string, number>();

  for (const t of target) {
    const regno = regnoOf.get(t.vehicle) || t.vehicle;
    const key = `${t.driver}|${t.date}`;
    dailyMin.set(key, (dailyMin.get(key) ?? 0) + elapsed(t.departAt, t.returnAt));

    let place = t.base, at = t.departAt, onboard = 0;
    for (const s of t.stops) {
      // 回送（前の地点 → 学校）
      segments.push({
        driver: t.driver, regno, users: passengers(onboard),
        from: place, to: s.school,
        startDay: t.date, startAt: at, endDay: t.date, endAt: s.arriveAt,
        duration: hm(elapsed(at, s.arriveAt)), note: '',
      });
      // 学校での待機（到着 → 乗車出発）
      if (s.departAt && s.departAt !== s.arriveAt) {
        segments.push({
          driver: t.driver, regno,
          users: onboard > 0 ? `${passengers(onboard)}／待機` : '待機',
          from: s.school, to: s.school,
          startDay: t.date, startAt: s.arriveAt, endDay: t.date, endAt: s.departAt,
          duration: hm(elapsed(s.arriveAt, s.departAt)), note: '学校で待機',
        });
      }
      onboard += s.count;
      place = s.school; at = s.departAt || s.arriveAt;
    }
    // 最終区間（最後の地点 → 到着場所）
    segments.push({
      driver: t.driver, regno, users: passengers(onboard),
      from: place, to: t.dest,
      startDay: t.date, startAt: at, endDay: t.date, endAt: t.returnAt,
      duration: hm(elapsed(at, t.returnAt)), note: '',
    });
  }

  const counts = BRACKETS.map(() => 0);
  const daily = [...dailyMin.entries()]
    .map(([k, min]) => {
      const [driver, date] = k.split('|') as [string, Day];
      counts[bracketIndex(min)]!++;
      return { date, driver, total: hm(min), bracket: BRACKETS[bracketIndex(min)]! };
    })
    .sort((a, b) => (a.date + a.driver < b.date + b.driver ? -1 : 1));

  return { counts, segments, daily };
}

export type AlcoholRow = {
  date: Day; driver: string; inspection: string;
  preAt: string; preResult: string; postAt: string; postResult: string;
  note: string; method: string; checker: string;
};

/** 安全運転管理者の記録簿。運転者・1日=1行。最初の運転前と最後の運転後を採る */
export function buildAlcoholReport(checks: AlcoholCheck[], ym: string): AlcoholRow[] {
  const map = new Map<string, AlcoholRow & { notes: string[] }>();
  for (const c of checks.filter(c => inMonth(c.date, ym))) {
    const key = `${c.date}|${c.driver}`;
    let row = map.get(key);
    if (!row) {
      row = { date: c.date, driver: c.driver, inspection: '', preAt: '', preResult: '',
              postAt: '', postResult: '', note: '', method: '', checker: '', notes: [] };
      map.set(key, row);
    }
    if (c.kind === '運転前') {
      if (!row.preAt) { row.preAt = c.at; row.preResult = normResult(c.result); row.inspection = c.inspection; }
    } else {
      row.postAt = c.at; row.postResult = normResult(c.result);   // 最後の運転後を採る
    }
    if (c.note && c.note !== '良好' && !row.notes.includes(c.note)) row.notes.push(c.note);
    if (c.checker) row.checker = c.checker;
    if (c.method) row.method = c.method;
  }
  return [...map.values()]
    .map(({ notes, ...r }) => ({ ...r, note: notes.join('／') || '良好' }))
    .sort((a, b) => (a.date + a.driver < b.date + b.driver ? -1 : 1));
}

/** 内部管理用の運行日報。1運行1行 */
export function buildTripReport(trips: Trip[], ym: string): Trip[] {
  return trips
    .filter(t => t.status === 'done' && inMonth(t.date, ym))
    .sort((a, b) => (a.date + a.departAt < b.date + b.departAt ? -1 : 1));
}

export function summarize(t: Trip): string {
  return t.stops
    .map(s => `${s.school} ${s.arriveAt}→${s.departAt}${s.count ? `（${s.count}人）` : '（乗車なし）'}`)
    .join(' ／ ');
}
