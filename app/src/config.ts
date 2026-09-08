/** 運用の設定。
 *
 *  運転手も管理者も、パスワードだけでログインする。Firebase の
 *  「メール/パスワード」認証はメールアドレスを必要とするので、
 *  役割ごとに1つの形式的なアドレスを決め打ちにし、画面ではパスワードだけ聞く。
 *  個人別のアドレスは作らない（誰が運転したかは画面で運転者を選んで記録する）。
 *
 *  実在のメールアドレスである必要はない（受信はしない）。
 *  パスワードそのものはこのコードには無く、Firebase 側に保管されている。
 *  変更したいときは Firebase コンソールでそのユーザーのパスワードを変えるだけでよい。 */
export const DRIVER_EMAIL = 'driver@yomicam-driving.firebaseapp.com';
export const ADMIN_EMAIL = 'admin@yomicam-driving.firebaseapp.com';

/** ?mock=1（開発・自動テスト）でだけ使う値。本番のパスワードとは無関係。
 *  本番のパスワードは Firebase Authentication 側にあり、このリポジトリには置かない。 */
export const MOCK_PASSWORD = 'mock';

/** 運行状況の警告のしきい値 */
export const ALERT = {
  stayMin: 30,    // 学校に着いてからこれを超えて乗車の記録がない
  tripMin: 120,   // 運行が終わらない（終了の押し忘れ）
};

/** ビルド時に埋め込まれる版数（vite.config.ts の define）。開発中は 'dev' */
declare const __BUILD__: string | undefined;
export const BUILD = typeof __BUILD__ === 'string' ? __BUILD__ : 'dev';
