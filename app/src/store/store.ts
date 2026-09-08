/** データ層の入口。開発・テストではメモリ実装、本番では Firestore 実装を使う。
 *  画面はこの型だけに依存させ、Firebase の有無に関わらず動かせるようにする。 */
import type { Trip, AlcoholCheck, Config, Stop, Day } from '../domain/types';

export type Snapshot = {
  config: Config;
  today: string;
  trips: Trip[];        // 当日分（運行中＋確定済み）
  checks: AlcoholCheck[]; // 当日分
  /** まだサーバへ送れていない記録の数。0 なら全部届いている */
  pending: number;
  /** 運転者・車両の一覧が登録済みか。false なら仮の名前のまま動いている */
  configured: boolean;
};

/** 管理者が直せる項目。運転手アプリからは触らない */
export type TripPatch = Partial<Pick<Trip,
  'vehicle' | 'driver' | 'base' | 'departAt' | 'dest' | 'returnAt' |
  'stops' | 'mokushi' | 'codomon' | 'note' | 'status'>>;

export type AlcoholPatch = Partial<Omit<AlcoholCheck, 'id'>>;

export interface Store {
  /** 変更のたびに呼ばれる。Firestore ではリアルタイム購読になる */
  subscribe(fn: (s: Snapshot) => void): () => void;

  // --- 運転手の操作 ---
  startTrip(input: { vehicle: string; driver: string; base: string }): Promise<void>;
  arriveSchool(tripId: string, school: string): Promise<void>;
  departSchool(tripId: string, count: number): Promise<void>;
  finishTrip(tripId: string, input: { dest: string; mokushi: boolean; codomon: boolean; note: string }): Promise<void>;
  undoLast(tripId: string): Promise<void>;
  cancelTrip(tripId: string): Promise<void>;
  recordAlcohol(input: Omit<AlcoholCheck, 'id' | 'date' | 'at'>): Promise<void>;
  undoAlcohol(kind: AlcoholCheck['kind'], driver: string): Promise<void>;

  // --- 管理者の是正操作 ---
  /** 当日分に限らず、過去の記録も直せる（月次提出前の修正で使う） */
  editTrip(tripId: string, patch: TripPatch): Promise<void>;
  addAlcohol(input: Omit<AlcoholCheck, 'id'>): Promise<void>;
  editAlcohol(id: string, patch: AlcoholPatch): Promise<void>;
  deleteAlcohol(id: string): Promise<void>;
  /** マスタ（運転者・車両・拠点・確認者・学校）の更新 */
  saveConfig(config: Config): Promise<void>;

  /** 月次帳票のためにひと月分をまとめて読む */
  loadMonth(ym: string): Promise<{ trips: Trip[]; checks: AlcoholCheck[] }>;
}

/** 記録できない操作。画面はこれを捕まえて理由を出す（再試行しない） */
export class InputError extends Error {}

/** 'YYYY-MM' からその月の日付の範囲 */
export function monthRange(ym: string): { from: Day; to: Day } {
  return { from: `${ym}-01`, to: `${ym}-31` };
}
