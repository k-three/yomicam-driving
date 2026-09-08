/** ログインの入口。運転手と管理者で「入口」と「できること」を分ける。
 *
 *  どちらもパスワードだけを入力させる。役割ごとに1つの形式的なメールアドレスを
 *  決め打ちにしてあるため（config.ts）、個人別のアカウントは作らない。
 *  パスワードは Firebase 側で照合されるので、画面のコードを読まれても突破できない。
 *
 *  管理者として中に入れるのは、さらに admins に自分の uid の文書がある人だけ。
 *  この文書はコンソールからしか作れない（firestore.rules で write: false）ので、
 *  誰も自分で管理者に昇格できない。 */
import {
  onAuthStateChanged, signInWithEmailAndPassword, signOut, type User,
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { fbAuth, fbDb } from './firebase';
import { ADMIN_EMAIL, DRIVER_EMAIL } from '../config';

/** いまログインしている人。まだ決まっていなければ決まるまで待つ */
function current(): Promise<User | null> {
  return new Promise(resolve => {
    const off = onAuthStateChanged(fbAuth(), u => { off(); resolve(u); });
  });
}

/** 指定のアカウントでログイン済みかどうか。端末に保存されるので次回は聞かれない */
async function signedInAs(...emails: string[]): Promise<User | null> {
  const u = await current();
  return u && u.email && emails.includes(u.email) ? u : null;
}

const signIn = (email: string, password: string) =>
  signInWithEmailAndPassword(fbAuth(), email, password).then(c => c.user);

/** 運転手アプリ。管理者のアカウントでも記録はできる */
export const currentDriverUser = () => signedInAs(DRIVER_EMAIL, ADMIN_EMAIL);
export const signInDriver = (password: string) => signIn(DRIVER_EMAIL, password);

/** 管理画面。運転手のアカウントでは入れない */
export const currentAdminUser = () => signedInAs(ADMIN_EMAIL);
export const signInAdmin = (password: string) => signIn(ADMIN_EMAIL, password);

export async function signOutNow() { await signOut(fbAuth()); }

/** admins/{uid} があるかどうか。これが管理者権限の唯一の根拠 */
export async function isAdmin(uid: string): Promise<boolean> {
  try {
    return (await getDoc(doc(fbDb(), 'admins', uid))).exists();
  } catch {
    return false;
  }
}
