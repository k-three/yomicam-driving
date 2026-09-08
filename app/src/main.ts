/** 運転手アプリの入口。管理画面は /admin.html（別の URL・別の権限）。
 *
 *  ?mock=1 を付けるとメモリ実装で動く。自動テストと、Firebase を触らずに
 *  画面だけ確かめたいときに使う。 */
import { App } from './ui/app';
import { MemoryStore } from './store/memory';
import { FirestoreStore } from './store/firestore';
import { currentDriverUser, signInDriver } from './store/auth';
import { passwordGate } from './ui/gate';
import { toast } from './ui/toast';
import { MOCK_PASSWORD } from './config';

const root = document.getElementById('app')!;
const NOTE = '運転手用のパスワードを入力してください。';

if (new URLSearchParams(location.search).get('mock') === '1') {
  const store = new MemoryStore();
  passwordGate(root, {
    title: '送迎記録', note: NOTE,
    signIn: async pw => {
      if (pw !== MOCK_PASSWORD) throw { code: 'auth/wrong-password' };
    },
    onOk: () => new App(root, store),
  });
} else {
  root.innerHTML = '<p class="boot">接続しています…</p>';
  const start = (uid: string) => new App(root, new FirestoreStore(uid, toast));
  currentDriverUser()
    .then(u => {
      if (u) return start(u.uid);
      passwordGate(root, {
        title: '送迎記録', note: NOTE,
        signIn: signInDriver,
        onOk: () => currentDriverUser().then(x => { if (x) start(x.uid); }),
      });
    })
    .catch((e: { code?: string; message?: string }) => {
      root.innerHTML = `<div class="boot">
        <p class="err">接続できませんでした</p>
        <p>電波の届く場所で、下のボタンを押してください。</p>
        <p class="note">${String(e.code ?? e.message ?? '')}</p>
        <button class="big" id="retry">やり直す</button></div>`;
      root.querySelector('#retry')!.addEventListener('click', () => location.reload());
    });
}
