/** パスワードの入力画面。運転手アプリと管理画面で同じものを使う。
 *  中身は Firebase 側で照合されるので、ここは入力を受け取るだけ。 */
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/* 入力欄に inputmode="numeric" を付けてはいけない。数字キーボードに固定されて
   英字を含むパスワードが打てなくなる（実機で発生した）。
   autocapitalize / autocorrect も切る。iPhone が先頭を大文字にしてしまうため。 */

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
      <div class="pw">
        <input id="pw" data-testid="pw" type="password"
          autocomplete="current-password" autocapitalize="off" autocorrect="off" spellcheck="false"
          placeholder="パスワード"${busy ? ' disabled' : ''}>
        <button type="button" id="peek" data-testid="peek" aria-label="パスワードを表示">表示</button>
      </div>
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

    // 伏せ字のままだと打ち間違いに気づけない。手元で確かめられるようにする
    const peek = root.querySelector<HTMLButtonElement>('#peek')!;
    peek.addEventListener('click', () => {
      const shown = pw.type === 'text';
      pw.type = shown ? 'password' : 'text';
      peek.textContent = shown ? '表示' : '隠す';
      peek.setAttribute('aria-label', shown ? 'パスワードを表示' : 'パスワードを隠す');
      pw.focus();
    });

    if (!busy) pw.focus();
  };
  draw('');
}
