/** 時刻の扱い。Apps Script 版では minutesBetween_ が負を 0 に丸めていたため
 *  前後関係の判定に使えず、時刻の逆転を見逃していた。ここでは分けて持つ。 */

/** 'HH:MM' を分に。形式が違えば null */
export function toMin(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t ?? ''));
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

/** 経過分。負や不正は 0（提供時間の集計用） */
export function elapsed(from: string, to: string): number {
  const a = toMin(from), b = toMin(to);
  if (a === null || b === null) return 0;
  return b > a ? b - a : 0;
}

/** from が to より後なら true。どちらかが不正なら false（判定しない） */
export function isAfter(from: string, to: string): boolean {
  const a = toMin(from), b = toMin(to);
  return a !== null && b !== null && a > b;
}

/** 90 → '1時間30分' */
export function hm(min: number): string {
  return `${Math.floor(min / 60)}時間${min % 60}分`;
}

/** 検知結果の表記をそろえる。'0.00' と書いてもスプレッドシートや入力経路で
 *  0 になることがあるため、数値なら小数2桁に。'検出' はそのまま。 */
export function normResult(v: unknown): string {
  if (v === '' || v === null || v === undefined) return '';
  const n = Number(v);
  return Number.isNaN(n) ? String(v) : n.toFixed(2);
}

/** 学校名の表記ゆれを吸収（「渡慶次小」と「渡慶次小学校」を同一視） */
export function normSchool(s: string): string {
  return String(s ?? '').replace(/[\s　]/g, '').replace(/学校$/, '');
}
