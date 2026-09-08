/** メモリ上のデータ層。開発と自動テストで使う。
 *  Firestore 実装と同じ規則（記録できない操作は InputError）を守るので、
 *  ここで通ったフローは本番でも同じ順序で通る。 */
import type { AlcoholCheck, Config, Stop, Trip } from '../domain/types';
import { InputError, type AlcoholPatch, type Snapshot, type Store, type TripPatch } from './store';
import { hhmm, today } from './clock';

/** マスタが未登録のときの初期値。
 *
 *  運転者と車両は**仮の名前**にしてある。実名はこのリポジトリに置かず、
 *  管理画面の「設定」から登録して Firestore（config/master）に保存する。
 *  学校と拠点は公共の施設名なのでそのまま入れてある。 */
export const SEED_CONFIG: Config = {
  drivers: ['運転者A', '運転者B', '運転者C', '運転者D', '運転者E', '運転者F',
            '運転者G', '運転者H', '運転者I', '運転者J', '運転者K'],
  vehicles: ['ハイエース', 'パッソ', 'フィット', 'ハスラー',
             'フリード1', 'フリード2', 'タント'].map(name => ({ name, regno: '', active: true })),
  bases: ['読谷村文化センター', '自宅', 'その他'],
  inspectors: ['安全運転管理者'],
  schools: ['読谷小学校', '渡慶次小学校', '喜名小学校', '古堅小学校', '古堅南小学校', 'よみたん自然学校'],
};

export class MemoryStore implements Store {
  private trips: Trip[] = [];
  private checks: AlcoholCheck[] = [];
  private listeners = new Set<(s: Snapshot) => void>();
  private seq = 0;

  constructor(private config: Config = SEED_CONFIG) {}

  /** 設定画面から保存されたら、仮の名前ではなくなる */
  private configured = false;

  /** 開発・確認用のサンプル。画面の見え方を確かめるためのもので、本番では使わない */
  seedSample() {
    const d = today();
    const t = (o: Partial<Trip> & Pick<Trip, 'id' | 'vehicle' | 'driver' | 'departAt'>): Trip => ({
      date: d, base: '読谷村文化センター', dest: '読谷村文化センター', returnAt: '',
      stops: [], mokushi: false, codomon: false, note: '', status: 'running', ...o,
    });
    this.trips = [
      t({ id: 's1', vehicle: 'ハイエース', driver: '運転者J', departAt: '13:05',
          returnAt: '13:52', status: 'done', mokushi: true, codomon: true,
          stops: [{ school: '渡慶次小学校', arriveAt: '13:18', departAt: '13:29', count: 3 }] }),
      t({ id: 's2', vehicle: 'フリード1', driver: '運転者K', departAt: '13:40',
          stops: [{ school: '古堅小学校', arriveAt: '13:55', departAt: '14:04', count: 2 },
                  { school: '喜名小学校', arriveAt: '14:16', departAt: '', count: 0 }] }),
      t({ id: 's3', vehicle: 'パッソ', driver: '運転者H', base: '自宅', departAt: '12:10',
          stops: [{ school: '読谷小学校', arriveAt: '12:31', departAt: '12:44', count: 1 }] }),
    ];
    this.checks = [
      { id: 'c1', date: d, kind: '運転前', driver: '運転者J', vehicle: 'ハイエース', at: '12:55',
        result: '0.00', inspection: '良', note: '良好', checker: '安全運転管理者', method: '対面' },
      { id: 'c2', date: d, kind: '運転後', driver: '運転者J', vehicle: 'ハイエース', at: '13:56',
        result: '0.00', inspection: '', note: '良好', checker: '安全運転管理者', method: '対面' },
      { id: 'c3', date: d, kind: '運転前', driver: '運転者K', vehicle: 'フリード1', at: '13:34',
        result: '0.00', inspection: '良', note: '良好', checker: '安全運転管理者', method: '対面' },
    ];
    this.emit();
  }

  subscribe(fn: (s: Snapshot) => void) {
    this.listeners.add(fn);
    fn(this.snapshot());
    return () => { this.listeners.delete(fn); };
  }

  private snapshot(): Snapshot {
    const d = today();
    return {
      config: this.config, today: d,
      trips: this.trips.filter(t => t.date === d),
      checks: this.checks.filter(c => c.date === d),
      pending: 0,
      configured: this.configured,
    };
  }
  private emit() { const s = this.snapshot(); this.listeners.forEach(fn => fn(s)); }

  private trip(id: string): Trip {
    const t = this.trips.find(x => x.id === id);
    if (!t) throw new InputError('運行が見つかりません。画面をリセットしてください。');
    return t;
  }
  private openStop(t: Trip): Stop | undefined {
    const last = t.stops[t.stops.length - 1];
    return last && !last.departAt ? last : undefined;
  }

  async startTrip({ vehicle, driver, base }: { vehicle: string; driver: string; base: string }) {
    const d = today();
    if (this.trips.some(t => t.vehicle === vehicle && t.status === 'running' && t.date === d))
      throw new InputError(`${vehicle} はすでに運行中です。`);
    if (!this.checks.some(c => c.date === d && c.kind === '運転前' && c.driver === driver))
      throw new InputError('先に運転前のアルコールチェックを記録してください。');
    this.trips.push({
      id: `${d.replace(/-/g, '')}-${vehicle}-${hhmm().replace(':', '')}-${++this.seq}`,
      date: d, vehicle, driver, base, departAt: hhmm(), dest: '読谷村文化センター', returnAt: '',
      stops: [], mokushi: false, codomon: false, note: '', status: 'running',
    });
    this.emit();
  }

  async arriveSchool(tripId: string, school: string) {
    const t = this.trip(tripId);
    if (this.openStop(t)) throw new InputError('先に乗車人数を記録してください。');
    t.stops.push({ school, arriveAt: hhmm(), departAt: '', count: 0 });
    this.emit();
  }

  async departSchool(tripId: string, count: number) {
    const t = this.trip(tripId);
    const stop = this.openStop(t);
    if (!stop) throw new InputError('到着した学校がありません。');
    stop.departAt = hhmm();
    stop.count = Math.max(0, Math.min(20, Math.round(count)));
    this.emit();
  }

  async finishTrip(tripId: string, input: { dest: string; mokushi: boolean; codomon: boolean; note: string }) {
    const t = this.trip(tripId);
    if (this.openStop(t)) throw new InputError('学校での乗車人数が未記録です。先に記録してください。');
    Object.assign(t, { ...input, returnAt: hhmm(), status: 'done' as const });
    this.emit();
  }

  async undoLast(tripId: string) {
    const t = this.trip(tripId);
    const open = this.openStop(t);
    if (open) t.stops.pop();
    else if (t.stops.length) { const last = t.stops[t.stops.length - 1]!; last.departAt = ''; last.count = 0; }
    else this.trips = this.trips.filter(x => x.id !== tripId);
    this.emit();
  }

  async cancelTrip(tripId: string) {
    this.trips = this.trips.filter(x => x.id !== tripId);
    this.emit();
  }

  // --- 管理者の是正操作 ---

  async editTrip(tripId: string, patch: TripPatch) {
    Object.assign(this.trip(tripId), patch);
    this.emit();
  }

  async addAlcohol(input: Omit<AlcoholCheck, 'id'>) {
    this.checks.push({ ...input, id: `a${++this.seq}` });
    this.emit();
  }

  async editAlcohol(id: string, patch: AlcoholPatch) {
    const c = this.checks.find(x => x.id === id);
    if (!c) throw new InputError('記録が見つかりません。');
    Object.assign(c, patch);
    this.emit();
  }

  async deleteAlcohol(id: string) {
    this.checks = this.checks.filter(x => x.id !== id);
    this.emit();
  }

  async saveConfig(config: Config) {
    this.config = config;
    this.configured = true;
    this.emit();
  }

  async loadMonth(ym: string) {
    const inMonth = (d: string) => d.slice(0, 7) === ym;
    return {
      trips: this.trips.filter(t => inMonth(t.date)),
      checks: this.checks.filter(c => inMonth(c.date)),
    };
  }

  async recordAlcohol(input: Omit<AlcoholCheck, 'id' | 'date' | 'at'>) {
    const d = today();
    if (input.kind === '運転後' &&
        !this.checks.some(c => c.date === d && c.kind === '運転前' && c.driver === input.driver))
      throw new InputError('先に運転前のアルコールチェックを記録してください。');
    this.checks.push({ ...input, id: `a${++this.seq}`, date: d, at: hhmm() });
    this.emit();
  }

  async undoAlcohol(kind: AlcoholCheck['kind'], driver: string) {
    const d = today();
    for (let i = this.checks.length - 1; i >= 0; i--) {
      const c = this.checks[i]!;
      if (c.date === d && c.kind === kind && c.driver === driver) { this.checks.splice(i, 1); break; }
    }
    this.emit();
  }
}
