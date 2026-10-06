/** 送迎記録の外のページ（虎の巻）から「🚨 緊急」を出すための部品。
 *
 *  虎の巻は別の Firebase プロジェクトで動いているが、送迎記録と同じサイト
 *  （k-three.github.io）に置かれている。ログイン状態は端末にサイト単位で保存されるので、
 *  この端末で送迎記録にログインしたことがあれば、ここでもそのまま緊急を出せる。
 *  ログインしていない端末では、最初の1回だけ送迎記録のパスワードを聞く。
 *
 *  画面は送迎記録の「🚨 緊急」とまったく同じもの（ui/emergency.ts）を使う。
 *  虎の巻の CSS と混ざらないよう、Shadow DOM の中に描く。
 *
 *  読み込みは alert.js が行う（ボタンが押されたとき、または画面が落ち着いたあと）。
 *  読み込んだだけでは何もしない。open() で初めて動く。 */
import styles from '../ui/styles.css?inline';
import board from '../ui/board.css?inline';
import type { Snapshot, Store } from '../store/store';
import { MemoryStore } from '../store/memory';
import { FirestoreStore } from '../store/firestore';
import { currentDriverUser, signInAdmin, signInDriver } from '../store/auth';
import { openEmergency } from '../ui/emergency';
import { passwordGate } from '../ui/gate';
import { MOCK_PASSWORD } from '../config';

/** 前回入力した名前。送迎記録アプリが覚えている運転者名も、同じサイトなので使える */
const NAME_KEY = 'yd-sos-name', DRIVER_KEY = 'yd-driver';
const mock = new URLSearchParams(location.search).get('mock') === '1';

const read = (k: string) => { try { return localStorage.getItem(k) ?? ''; } catch { return ''; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* 保存できない端末 */ } };

let shadow: ShadowRoot | null = null;
function root(): ShadowRoot {
  if (shadow) return shadow;
  const host = document.createElement('div');
  host.id = 'yomicam-sos';
  document.body.appendChild(host);
  shadow = host.attachShadow({ mode: 'open' });
  // 送迎記録の見た目をそのまま持ち込む。:root の色の定義は Shadow DOM の中では
  // 効かないので :host に付け替える
  const css = (styles + '\n' + board).replace(/:root/g, ':host');
  shadow.innerHTML = `<style>${css}
    :host{font-family:"Noto Sans JP","Hiragino Sans","Yu Gothic",system-ui,sans-serif;
      font-size:16px;line-height:1.55;color:var(--ink)}
    dialog.gate{border:none;border-radius:16px;padding:8px 22px 18px;max-width:420px;width:calc(100% - 32px);
      background:var(--bg);color:var(--ink);box-shadow:0 18px 60px rgba(0,0,0,.25)}
    dialog.gate::backdrop{background:rgba(20,30,28,.45)}
    dialog.gate .signin{margin:12px auto}
  </style>`;
  return shadow;
}

/** alert.js の帯を、この端末での操作に合わせてすぐ切り替える（次の確認を待たない） */
function tellBanner(s: Snapshot) {
  const i = s.incident;
  window.dispatchEvent(new CustomEvent('yomicam-alert', { detail: i
    ? { active: true, sinceMs: i.startedMs, sinceHm: i.startedAt, kind: i.kind }
    : { active: false } }));
}

let store: Store | null = null;
let latest: Snapshot | null = null;

/** 最初の1回だけ、設定（連絡先・児童）が届くのを少し待つ。届かなくても先へ進む */
function attach(s: Store): Promise<void> {
  store = s;
  return new Promise(resolve => {
    const t = setTimeout(resolve, 2500);
    s.subscribe(snap => {
      const first = !latest;
      latest = snap;
      if (!first) tellBanner(snap);
      if (snap.configured) { clearTimeout(t); resolve(); }
    });
  });
}

/** ログインの画面。通ったら resolve、閉じたら null */
function gate(signIn: (pw: string) => Promise<unknown>): Promise<boolean> {
  const r = root();
  const d = document.createElement('dialog');
  d.className = 'gate';
  d.innerHTML = '<div data-gate></div><button type="button" class="link" data-close>閉じる</button>';
  r.appendChild(d);
  d.showModal();
  return new Promise(resolve => {
    d.querySelector('[data-close]')!.addEventListener('click', () => { d.close(); });
    d.addEventListener('close', () => { d.remove(); resolve(false); });
    passwordGate(d.querySelector<HTMLElement>('[data-gate]')!, {
      title: '🚨 緊急（送迎記録）',
      note: '送迎記録と同じパスワードを入力してください。この端末では次回から聞かれません。',
      signIn,
      onOk: () => { resolve(true); d.close(); },
    });
  });
}

/** 運転手用・管理者用のどちらのパスワードでも通す（どちらでも緊急は出せる） */
async function signInEither(pw: string) {
  try { await signInDriver(pw); }
  catch (e) {
    const code = (e as { code?: string }).code ?? '';
    if (!/invalid-credential|wrong-password|user-not-found/.test(code)) throw e;
    await signInAdmin(pw);
  }
}

async function ready(): Promise<boolean> {
  if (store) return true;
  if (mock) {
    // 自動テスト用。本物の Firebase には触らない
    if (!(await gate(async pw => { if (pw !== MOCK_PASSWORD) throw { code: 'auth/wrong-password' }; })))
      return false;
    const m = new MemoryStore();
    m.seedChildren(); m.seedContacts();
    await attach(m);
    return true;
  }
  let user = await currentDriverUser();
  if (!user) {
    if (!(await gate(signInEither))) return false;
    user = await currentDriverUser();
    if (!user) return false;
  }
  await attach(new FirestoreStore(user.uid, msg => alert(msg)));
  return true;
}

/** 「🚨 緊急」が押されたとき */
export async function open() {
  if (!(await ready()) || !store || !latest) return;
  const s = store, snap = latest, c = snap.config;
  const initial = read(NAME_KEY) || read(DRIVER_KEY);
  const remember = (name: string) => { if (!/名前未入力/.test(name)) write(NAME_KEY, name); };
  const sync = () => { if (latest) tellBanner(latest); };
  openEmergency({
    incident: snap.incident, config: c, via: '虎の巻',
    who: initial, vehicle: '', place: '',
    askWho: { initial, suggestions: [...new Set([...c.drivers, ...c.contacts.map(x => x.name)])] },
    // 送迎以外の場面が多いので、拠点を先に出す
    placeChoices: [...c.bases, ...c.schools],
    kids: c.children.filter(k => k.active),
    host: root(),
    raise: input => {
      remember(input.driver);
      s.raiseIncident(input).then(sync).catch(e => alert(`緊急を出せませんでした。電話で連絡してください。\n\n${e?.message ?? e}`));
    },
    close: (id, outcome, note, by) => {
      remember(by);
      s.closeIncident(id, outcome, { by, note }).then(sync).catch(e => alert(`閉じられませんでした。\n\n${e?.message ?? e}`));
    },
  });
}
