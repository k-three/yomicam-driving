/** Firestore のデータ層。MemoryStore とまったく同じ規則で動く。
 *
 *  設計の要点
 *  - 書き込みは待たない。電波が切れていても端末内キャッシュに入り、
 *    画面はすぐ更新される（Firestore の遅延補償）。届いていない件数は
 *    Snapshot.pending で画面に出す。運転手を電波待ちで止めないための作り。
 *  - 順序の規則（運転前チェックが先、乗車人数が先）は手元の最新スナップショットで
 *    判定する。セキュリティルールは「確定済みの帳簿を書き換えさせない」線を守る役で、
 *    業務の順序はこちらが受け持つ。
 *  - 日付が変わったら購読し直す。日をまたいで開きっぱなしでも当日分に切り替わる。
 */
import {
  addDoc, collection, deleteDoc, doc, getDocs, onSnapshot, query, setDoc, updateDoc, where,
  type QuerySnapshot,
} from 'firebase/firestore';
import type { AlcoholCheck, Config, Stop, Trip } from '../domain/types';
import {
  InputError, monthRange, type AlcoholPatch, type Snapshot, type Store, type TripPatch,
} from './store';
import { hhmm, today } from './clock';
import { SEED_CONFIG } from './memory';
import { fbDb } from './firebase';

/** 日付の切り替わりを見に行く間隔 */
const DAY_WATCH_MS = 30_000;

type Doc = Record<string, unknown>;

/** Firestore から来た値を型どおりに整える。欠けたフィールドで画面を壊さない */
function toTrip(id: string, d: Doc): Trip {
  const stops = Array.isArray(d.stops) ? (d.stops as Doc[]) : [];
  return {
    id,
    date: String(d.date ?? ''),
    vehicle: String(d.vehicle ?? ''),
    driver: String(d.driver ?? ''),
    base: String(d.base ?? ''),
    departAt: String(d.departAt ?? ''),
    dest: String(d.dest ?? ''),
    returnAt: String(d.returnAt ?? ''),
    stops: stops.map(s => ({
      school: String(s.school ?? ''),
      arriveAt: String(s.arriveAt ?? ''),
      departAt: String(s.departAt ?? ''),
      count: Number(s.count ?? 0),
    })),
    mokushi: d.mokushi === true,
    codomon: d.codomon === true,
    note: String(d.note ?? ''),
    status: d.status === 'done' ? 'done' : 'running',
  };
}

function toCheck(id: string, d: Doc): AlcoholCheck {
  return {
    id,
    date: String(d.date ?? ''),
    kind: d.kind === '運転後' ? '運転後' : '運転前',
    driver: String(d.driver ?? ''),
    vehicle: String(d.vehicle ?? ''),
    at: String(d.at ?? ''),
    result: String(d.result ?? ''),
    inspection: String(d.inspection ?? ''),
    note: String(d.note ?? ''),
    checker: String(d.checker ?? ''),
    method: String(d.method ?? ''),
  };
}

/** config/master が未作成でも動くよう、足りない項目は初期値で埋める */
function toConfig(d: Doc | null): Config {
  if (!d) return SEED_CONFIG;
  const list = (v: unknown, fb: string[]) =>
    Array.isArray(v) && v.length ? v.map(String) : fb;
  const vehicles = Array.isArray(d.vehicles) && d.vehicles.length
    ? (d.vehicles as Doc[]).map(v => ({
        name: String(v.name ?? ''), regno: String(v.regno ?? ''), active: v.active !== false }))
    : SEED_CONFIG.vehicles;
  return {
    drivers: list(d.drivers, SEED_CONFIG.drivers),
    vehicles,
    bases: list(d.bases, SEED_CONFIG.bases),
    inspectors: list(d.inspectors, SEED_CONFIG.inspectors),
    schools: list(d.schools, SEED_CONFIG.schools),
  };
}

const pendingIn = (s: QuerySnapshot | null) =>
  s ? s.docs.filter(d => d.metadata.hasPendingWrites).length : 0;

export class FirestoreStore implements Store {
  private db = fbDb();
  private config: Config = SEED_CONFIG;
  /** config/master がまだ無いあいだは、仮の名前で動いている */
  private configured = false;
  private trips: Trip[] = [];
  private checks: AlcoholCheck[] = [];
  private tripSnap: QuerySnapshot | null = null;
  private checkSnap: QuerySnapshot | null = null;
  private day = today();
  private listeners = new Set<(s: Snapshot) => void>();
  private offDay: Array<() => void> = [];
  private offAll: Array<() => void> = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  /**
   * @param uid   ログイン中の利用者。記録した人として残し、ルールの判定にも使う
   * @param onError 届かなかった書き込みの通知先（画面のトーストなど）
   */
  constructor(private uid: string, private onError: (msg: string) => void = () => {}) {}

  subscribe(fn: (s: Snapshot) => void) {
    this.listeners.add(fn);
    if (this.listeners.size === 1) this.start();
    fn(this.snapshot());
    return () => {
      this.listeners.delete(fn);
      if (this.listeners.size === 0) this.stop();
    };
  }

  private start() {
    this.offAll.push(onSnapshot(doc(this.db, 'config', 'master'),
      s => {
        this.configured = s.exists();
        this.config = toConfig(s.exists() ? (s.data() as Doc) : null);
        this.emit();
      },
      e => this.onError(`設定を読み込めませんでした（${e.code}）`)));
    this.watchDay();
    this.timer = setInterval(() => {
      if (today() !== this.day) { this.day = today(); this.watchDay(); }
    }, DAY_WATCH_MS);
  }

  private stop() {
    [...this.offAll, ...this.offDay].forEach(off => off());
    this.offAll = []; this.offDay = [];
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  /** 当日分だけを購読する。読み込む量を当日に絞ることで、無料枠でも回る */
  private watchDay() {
    this.offDay.forEach(off => off());
    this.trips = []; this.checks = [];
    this.tripSnap = null; this.checkSnap = null;
    const d = this.day;
    this.offDay = [
      onSnapshot(query(collection(this.db, 'trips'), where('date', '==', d)),
        s => { this.tripSnap = s; this.trips = s.docs.map(x => toTrip(x.id, x.data() as Doc)); this.emit(); },
        e => this.onError(`運行記録を読み込めませんでした（${e.code}）`)),
      onSnapshot(query(collection(this.db, 'alcohol'), where('date', '==', d)),
        s => { this.checkSnap = s; this.checks = s.docs.map(x => toCheck(x.id, x.data() as Doc)); this.emit(); },
        e => this.onError(`アルコールチェックを読み込めませんでした（${e.code}）`)),
    ];
    this.emit();
  }

  private snapshot(): Snapshot {
    return {
      config: this.config,
      today: this.day,
      trips: [...this.trips].sort((a, b) => a.departAt.localeCompare(b.departAt)),
      checks: [...this.checks].sort((a, b) => a.at.localeCompare(b.at)),
      pending: pendingIn(this.tripSnap) + pendingIn(this.checkSnap),
      configured: this.configured,
    };
  }
  private emit() { const s = this.snapshot(); this.listeners.forEach(fn => fn(s)); }

  /** 送信は待たない。オフラインでも端末内に入り、電波が戻れば自動で届く */
  private send(p: Promise<unknown>) {
    p.catch((e: { code?: string; message?: string }) => {
      this.onError(e.code === 'permission-denied'
        ? 'この記録を保存する権限がありません。管理者に連絡してください。'
        : `保存できませんでした（${e.code ?? e.message ?? '原因不明'}）`);
    });
  }

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
    const d = this.day;
    if (this.trips.some(t => t.vehicle === vehicle && t.status === 'running'))
      throw new InputError(`${vehicle} はすでに運行中です。`);
    if (!this.checks.some(c => c.kind === '運転前' && c.driver === driver))
      throw new InputError('先に運転前のアルコールチェックを記録してください。');
    const at = hhmm();
    const id = `${d.replace(/-/g, '')}-${vehicle}-${at.replace(':', '')}`;
    this.send(setDoc(doc(this.db, 'trips', id), {
      date: d, vehicle, driver, base, departAt: at, dest: '読谷村文化センター', returnAt: '',
      stops: [], mokushi: false, codomon: false, note: '', status: 'running', createdBy: this.uid,
    }));
  }

  async arriveSchool(tripId: string, school: string) {
    const t = this.trip(tripId);
    if (this.openStop(t)) throw new InputError('先に乗車人数を記録してください。');
    const stops = [...t.stops, { school, arriveAt: hhmm(), departAt: '', count: 0 }];
    this.send(updateDoc(doc(this.db, 'trips', tripId), { stops }));
  }

  async departSchool(tripId: string, count: number) {
    const t = this.trip(tripId);
    if (!this.openStop(t)) throw new InputError('到着した学校がありません。');
    const stops = t.stops.map((s, i) => i === t.stops.length - 1
      ? { ...s, departAt: hhmm(), count: Math.max(0, Math.min(20, Math.round(count))) } : s);
    this.send(updateDoc(doc(this.db, 'trips', tripId), { stops }));
  }

  async finishTrip(tripId: string, input: { dest: string; mokushi: boolean; codomon: boolean; note: string }) {
    const t = this.trip(tripId);
    if (this.openStop(t)) throw new InputError('学校での乗車人数が未記録です。先に記録してください。');
    this.send(updateDoc(doc(this.db, 'trips', tripId), { ...input, returnAt: hhmm(), status: 'done' }));
  }

  async undoLast(tripId: string) {
    const t = this.trip(tripId);
    if (this.openStop(t)) {
      this.send(updateDoc(doc(this.db, 'trips', tripId), { stops: t.stops.slice(0, -1) }));
    } else if (t.stops.length) {
      const stops = t.stops.map((s, i) =>
        i === t.stops.length - 1 ? { ...s, departAt: '', count: 0 } : s);
      this.send(updateDoc(doc(this.db, 'trips', tripId), { stops }));
    } else {
      this.send(deleteDoc(doc(this.db, 'trips', tripId)));
    }
  }

  async cancelTrip(tripId: string) {
    this.send(deleteDoc(doc(this.db, 'trips', tripId)));
  }

  // --- 管理者の是正操作 ---
  // 当日分の購読には無い記録（過去の月）も直せるよう、手元の一覧は参照しない。
  // 対象が無ければ Firestore 側で失敗し、onError で理由が出る。

  async editTrip(tripId: string, patch: TripPatch) {
    this.send(updateDoc(doc(this.db, 'trips', tripId), { ...patch }));
  }

  async addAlcohol(input: Omit<AlcoholCheck, 'id'>) {
    this.send(addDoc(collection(this.db, 'alcohol'), { ...input, createdBy: this.uid }));
  }

  async editAlcohol(id: string, patch: AlcoholPatch) {
    this.send(updateDoc(doc(this.db, 'alcohol', id), { ...patch }));
  }

  async deleteAlcohol(id: string) {
    this.send(deleteDoc(doc(this.db, 'alcohol', id)));
  }

  async saveConfig(config: Config) {
    this.send(setDoc(doc(this.db, 'config', 'master'), { ...config }));
  }

  /** 月次帳票用。当日分の購読とは別に、その月だけを1回読む */
  async loadMonth(ym: string) {
    const { from, to } = monthRange(ym);
    const span = (name: string) => query(collection(this.db, name),
      where('date', '>=', from), where('date', '<=', to));
    const [t, a] = await Promise.all([getDocs(span('trips')), getDocs(span('alcohol'))]);
    return {
      trips: t.docs.map(x => toTrip(x.id, x.data() as Doc)),
      checks: a.docs.map(x => toCheck(x.id, x.data() as Doc)),
    };
  }

  async recordAlcohol(input: Omit<AlcoholCheck, 'id' | 'date' | 'at'>) {
    if (input.kind === '運転後' &&
        !this.checks.some(c => c.kind === '運転前' && c.driver === input.driver))
      throw new InputError('先に運転前のアルコールチェックを記録してください。');
    this.send(addDoc(collection(this.db, 'alcohol'),
      { ...input, date: this.day, at: hhmm(), createdBy: this.uid }));
  }

  async undoAlcohol(kind: AlcoholCheck['kind'], driver: string) {
    const c = this.checks.filter(x => x.kind === kind && x.driver === driver).slice(-1)[0];
    if (!c) return;
    this.send(deleteDoc(doc(this.db, 'alcohol', c.id)));
  }
}
