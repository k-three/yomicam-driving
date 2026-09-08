/** Firebase の初期化。アプリ全体で1つだけ持つ。
 *  Firestore はオフラインでも記録できるよう、端末内キャッシュを有効にして開く。
 *  車内は電波が切れることがあるので、これは運用上の必須条件。 */
import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, type Firestore,
} from 'firebase/firestore';
import { firebaseConfig } from '../firebase-config';

let _app: FirebaseApp | null = null;
let _db: Firestore | null = null;

export function fbApp(): FirebaseApp {
  if (!_app) _app = getApps()[0] ?? initializeApp(firebaseConfig);
  return _app;
}

export function fbAuth(): Auth { return getAuth(fbApp()); }

export function fbDb(): Firestore {
  if (!_db) _db = initializeFirestore(fbApp(), {
    // 端末内に保存し、電波が戻ったときに自動で送る。複数タブでも壊れない設定
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
  return _db;
}
