/** 管理画面の入口。運転手アプリ（/）とは別の URL・別の権限で動く。
 *
 *  パスワードは Firebase 側で照合される（メール／パスワード認証）。
 *  さらに admins に自分の uid の文書がある人だけが中に入れる。
 *  ?mock=1 を付けるとサンプルデータで見え方だけ確かめられる（Firebase に触らない）。 */
import { MemoryStore } from './store/memory';
import { FirestoreStore } from './store/firestore';
import { currentAdminUser, isAdmin, signInAdmin, signOutNow } from './store/auth';
import { AdminApp } from './ui/adminApp';
import { passwordGate } from './ui/gate';
import { toast } from './ui/toast';
import { setNow } from './store/clock';

const root = document.getElementById('app')!;
const params = new URLSearchParams(location.search);
const mock = params.get('mock') === '1' || params.has('sample');
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

const signInScreen = () => passwordGate(root, {
  title: '運行状況', note: '管理者用の画面です。パスワードを入力してください。',
  signIn: signInAdmin, onOk: boot,
});

/** 管理者名簿に載っていない人向け。uid を出して、登録を頼めるようにする */
function notAdminScreen(uid: string) {
  root.innerHTML = `<div class="signin">
    <p class="logo">運行状況<small>よみたん放課後キャンパス</small></p>
    <p class="err">この画面を見る権限がありません</p>
    <p class="note">下の ID を Firestore の <b>admins</b> に、<br>
      ドキュメントID としてそのまま追加してください。</p>
    <p class="uid" data-testid="uid">${esc(uid)}</p>
    <button class="big secondary" id="logout">ログインし直す</button></div>`;
  root.querySelector('#logout')!.addEventListener('click',
    () => signOutNow().then(() => signInScreen()));
}

async function boot() {
  root.innerHTML = '<p class="boot">確認しています…</p>';
  const user = await currentAdminUser();
  if (!user) return signInScreen();
  if (!(await isAdmin(user.uid))) return notAdminScreen(user.uid);
  new AdminApp(root, new FirestoreStore(user.uid, toast));
}

if (mock) {
  // サンプルは午後の送迎を想定している。時計を合わせておかないと絵が噛み合わない
  const withSample = params.get('sample') !== '0';
  if (withSample) { const d = new Date(); d.setHours(14, 20, 0, 0); setNow(d); }
  const store = new MemoryStore();
  new AdminApp(root, store, withSample
    ? '<p class="sample">開発用のサンプルデータを表示しています（本番のデータではありません）。</p>' : '');
  if (withSample) store.seedSample();
} else {
  boot();
}
