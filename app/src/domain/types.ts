/** 送迎記録アプリのデータモデル。
 *  Apps Script 版では運行中の状態を「進行中」シートに状態JSONとして持っていたが、
 *  ここでは運行そのものに status を持たせ、運行中と確定済みを同じ形で扱う。
 *  これにより「運行中の記録だけ手で直せない」という問題が構造的に消える。 */

/** 'HH:MM'。未記録は '' */
export type Time = string;
/** 'YYYY-MM-DD' */
export type Day = string;

/** 乗せた児童。記録そのものに氏名を持たせる（マスタを引かずに読めるようにする）。
 *  月次で提出したあとにマスタを直しても、過去の記録が変わらないため。 */
export type Rider = {
  /** 報告書に載せる正式な氏名 */
  name: string;
  /** ふだん画面に出す呼び名 */
  alias: string;
};

export type Stop = {
  school: string;
  arriveAt: Time;
  departAt: Time;   // 乗車出発。まだなら ''
  count: number;    // riders の人数。氏名を登録する前の記録は人数だけを持つ
  riders?: Rider[];
};

export type Trip = {
  id: string;
  date: Day;
  vehicle: string;
  driver: string;
  base: string;
  departAt: Time;
  dest: string;
  returnAt: Time;   // 運行中は ''
  stops: Stop[];
  mokushi: boolean; // 車内目視（置き去り防止）
  handover: boolean;
  note: string;
  status: 'running' | 'done';
};

export type AlcoholKind = '運転前' | '運転後';

export type AlcoholCheck = {
  id: string;
  date: Day;
  kind: AlcoholKind;
  driver: string;
  vehicle: string;
  at: Time;
  result: string;     // '0.00' または '検出'
  inspection: string; // 日常点検 '良' | '否'。運転後は ''
  note: string;
  checker: string;
  method: string;     // 対面 / 写真送付 / 電話 / ビデオ
  /** 検知器の表示を撮った写真があるか。画像は alcoholPhotos/{id} に別置き
   *  （一覧を開くたびに画像まで読み込まないようにするため） */
  photo?: boolean;
};

export type Vehicle = { name: string; regno: string; active: boolean };

/** 送迎する児童。氏名はこのリポジトリに置かず、管理画面の「設定」から
 *  登録して Firestore（config/master）に保存する。 */
export type Child = {
  /** 報告書に載せる正式な氏名 */
  name: string;
  /** ふだん画面に出す呼び名 */
  alias: string;
  /** どの学校で乗るか。学校ボタンから絞り込むのに使う */
  school: string;
  grade: string;
  active: boolean;
};

export type Config = {
  drivers: string[];
  vehicles: Vehicle[];
  children: Child[];
  bases: string[];
  inspectors: string[];
  schools: string[];
};

export type Severity = '要確認' | '確認推奨';

/** 指摘をどこで直すか。画面の「直す」ボタンの行き先になる */
export type FixTarget =
  | { kind: 'trip'; id: string }
  | { kind: 'alcohol'; id: string }
  | { kind: 'config' };

export type Finding = {
  severity: Severity;
  /** 該当する運行。運行に紐づかない指摘は '' */
  tripId: string;
  fix: FixTarget;
  date: Day;
  subject: string;
  what: string;
  how: string;
};
