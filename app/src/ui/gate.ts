/** パスワードの入力画面。運転手アプリと管理画面で同じものを使う。
 *  中身は Firebase 側で照合されるので、ここは入力を受け取るだけ。 */
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** Firebase から返る失敗の理由を、現場で読める言葉にする */
export function loginError(e: { code?: string }): string {
  switch (e.code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/invalid-email':
    case 'auth/user-not-found':
    case 'auth/missing-password':
      return 'パスワードが違います';
    case 'auth/too-many-requests':
      return '試行が多すぎます。しばらく待ってからお試しください';
    case 'auth/network-request-failed':
      return 'ネットワークに接続できませんでした';
    case 'auth/operation-not-allowed':
      return 'この方式のログインが有効になっていません（管理者に連絡してください）';
    default:
      return `ログインできませんでした（${e.code ?? '原因不明'}）`;
  }
}

export type GateOptions = {
  title: string;
  note: string;
  /** 通れば解決、通らなければ理由つきで失敗する */
  signIn: (password: string) => Promise<unknown>;
  onOk: () => void;
};

export function passwordGate(root: HTMLElement, o: GateOptions) {
  const draw = (msg: string, busy = false) => {
    root.innerHTML = `<div class="signin">
      <p class="logo">${esc(o.title)}<small>よみたん放課後キャンパス</small></p>
      <p class="note">${esc(o.note)}</p>
      <input id="pw" data-testid="pw" type="password" inputmode="numeric"
        autocomplete="current-password" placeholder="パスワード"${busy ? ' disabled' : ''}>
      <p class="err" data-testid="pw-error">${esc(msg)}</p>
      <button class="big" id="login" data-testid="login"${busy ? ' disabled' : ''}>${
        busy ? '確認しています…' : 'ログイン'}</button>
      <p class="note">この端末では次回から聞かれません。</p></div>`;

    const pw = root.querySelector<HTMLInputElement>('#pw')!;
    const submit = () => {
      const value = pw.value;
      draw('', true);
      o.signIn(value).then(o.onOk).catch((e: { code?: string }) => draw(loginError(e)));
    };
    root.querySelector('#login')!.addEventListener('click', submit);
    pw.addEventListener('keydown', e => { if ((e as KeyboardEvent).key === 'Enter') submit(); });
    if (!busy) pw.focus();
  };
  draw('');
}
