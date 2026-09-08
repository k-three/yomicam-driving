/** 時刻の供給元。テストでは固定できるようにする */
let fixed: Date | null = null;
export function setNow(d: Date | null) { fixed = d; }
export function now(): Date { return fixed ? new Date(fixed) : new Date(); }
export function today(): string {
  const d = now();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function hhmm(): string {
  const d = now();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
