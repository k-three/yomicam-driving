/** 緊急対応（こどもの所在不明・ケガ・体調不良・交通事故など）の入口。
 *
 *  やることは2つだけに絞ってある。
 *    1. 電話をかける（連絡先は設定で登録したもの。上から順に優先）
 *    2. 「緊急対応中」を立てる → 送迎記録・虎の巻のすべての画面の先頭に赤い帯が出る
 *
 *  帯は誰かが「解決」か「取り消し」を押すまで消えない。開始から解決までが
 *  1件の記録として残るので、あとから保護者への説明や事後報告に使える。
 *  迷ったら出してよい（取り消しも記録に残るだけで、罰にはならない）。 */
import { INCIDENT_KINDS, kindOf, type Child, type Config, type Incident } from '../domain/types';
import type { IncidentInput } from '../store/store';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** 経過時間の文字。帯と画面で同じ言い回しにする */
export function elapsedText(sinceMs: number, nowMs = Date.now()): string {
  const min = Math.max(0, Math.floor((nowMs - sinceMs) / 60_000));
  return min < 60 ? `${min}分経過` : `${Math.floor(min / 60)}時間${min % 60}分経過`;
}

/** Slack への投稿をこの時間待っても結果が戻らなければ、手動での投稿を促す */
const SLACK_WAIT_MS = 90_000;
const SLACK_UNCONFIRMED = '⚠ Slack への投稿を確認できません。手動で投稿してください';

/** Slack に届いたか。押した人が「全員に伝わった」と思い込まないよう、正直に出す */
function slackLine(inc: Incident): string {
  if (inc.pending)
    return `<span class="sos-slack ng" data-testid="sos-slack">📡 まだ送信できていません（電波を確認）。全員には届いていません — 電話で伝えてください</span>`;
  if (inc.slack?.ok)
    return `<span class="sos-slack ok" data-testid="sos-slack">✓ Slack に投稿済み</span>`;
  if (inc.slack)
    return `<span class="sos-slack ng" data-testid="sos-slack">⚠ Slack に投稿できませんでした。手動で投稿してください</span>`;
  const late = Date.now() - inc.startedMs > SLACK_WAIT_MS;
  return `<span class="sos-slack${late ? ' ng' : ''}" data-testid="sos-slack" data-slack-wait="${inc.startedMs}">${
    late ? SLACK_UNCONFIRMED : 'Slack に投稿しています…'}</span>`;
}

/** 帯や詳細での「対象の児童」の短い言い方 */
const kidsLabel = (kind: string) =>
  !kind || kind === '所在不明' ? '来ていない' : kind === 'ケガ' ? 'ケガ' : kind === '体調不良' ? '体調不良' : '対象';

/** 救急・警察へすぐかけるボタン。社内の連絡先より先に置く */
const DIAL: Record<string, string> = { '119': '🚑 119（救急）', '110': '🚓 110（警察）' };
const dialButtons = (nums: readonly string[]) => nums.map(n =>
  `<a class="big call public" data-testid="dial-${n}" href="tel:${n}">${DIAL[n] ?? n}</a>`).join('');

/** すべての画面の先頭に出す帯。無ければ空文字 */
export function incidentBanner(inc: Incident | null): string {
  if (!inc) return '';
  const who = [inc.driver, inc.vehicle, inc.place].filter(Boolean).join('・');
  const kids = inc.riders.length ? `　${kidsLabel(inc.kind)}：${esc(inc.riders.join('・'))}` : '';
  return `<div class="sos-banner" role="alert" data-testid="sos-banner">
    <div class="sos-main">
      <b>🚨 緊急対応中${inc.kind ? `：${esc(inc.kind)}` : ''}</b>
      <span class="sos-time">${esc(inc.startedAt)}〜　<em data-since-ms="${inc.startedMs}">${elapsedText(inc.startedMs)}</em></span>
    </div>
    <div class="sos-detail">${esc(who)}${kids}${inc.note ? `　${esc(inc.note)}` : ''}</div>
    ${slackLine(inc)}
    <button type="button" class="sos-act" data-act="sos">対応・解決</button>
  </div>`;
}

/** 経過時間を、画面を描き直さずに進める。1ページに1つだけ動かす */
let ticker: ReturnType<typeof setInterval> | null = null;
export function startElapsedTicker() {
  if (ticker) return;
  ticker = setInterval(() => {
    const now = Date.now();
    document.querySelectorAll<HTMLElement>('[data-since-ms]').forEach(el => {
      el.textContent = elapsedText(Number(el.dataset.sinceMs), now);
    });
    // 結果が戻らないまま時間が過ぎたら、待っている表示を「確認できない」に切り替える
    document.querySelectorAll<HTMLElement>('[data-slack-wait]').forEach(el => {
      if (now - Number(el.dataset.slackWait) > SLACK_WAIT_MS) {
        el.textContent = SLACK_UNCONFIRMED; el.classList.add('ng');
      }
    });
  }, 30_000);
}

/** 電話をかける部分。連絡先を選んで、大きなボタンで発信する */
function phoneSection(config: Config): string {
  const list = config.contacts.filter(c => c.phone);
  if (!list.length)
    return `<p class="sub">📞 まず電話</p>
      <p class="note">緊急連絡先がまだ登録されていません。管理画面の「設定」から登録してください。</p>`;
  const first = list[0]!;
  return `<p class="sub">📞 まず電話（上から順に優先）</p>
    <label class="fld"><span>連絡先</span>
      <select name="contact" data-testid="contact">${list.map((c, i) =>
        `<option value="${i}">${esc(c.name)}${c.note ? `（${esc(c.note)}）` : ''}　${esc(c.phone)}</option>`).join('')}</select></label>
    <a class="big call" data-testid="call" href="tel:${esc(first.phone)}">📞 ${esc(first.name)} に電話する</a>`;
}

export type EmergencyOpts = {
  incident: Incident | null;
  config: Config;
  /** いま操作している人（運転者名。管理画面なら '管理者'） */
  who: string;
  vehicle: string;
  /** いまいる場所。分からなければ '' にすると、画面で選ばせる */
  place: string;
  /** 対象の児童の候補。乗せている児童と、いる学校の児童。分からなければ全員 */
  kids: Child[];
  raise: (input: IncidentInput) => void;
  close: (id: string, outcome: 'resolved' | 'cancelled', note: string) => void;
};

export function openEmergency(o: EmergencyOpts) {
  const d = document.createElement('dialog');
  d.className = 'editor sos';
  const inc = o.incident;

  const body = inc ? `
    <h2 tabindex="-1">🚨 緊急対応中${inc.kind ? `：${esc(inc.kind)}` : ''}</h2>
    <p class="who">${esc(inc.startedAt)}〜（<em data-since-ms="${inc.startedMs}">${elapsedText(inc.startedMs)}</em>）<br>
      ${esc([inc.driver, inc.vehicle, inc.place].filter(Boolean).join('・'))}${
      inc.riders.length ? `<br>${kidsLabel(inc.kind)}：${esc(inc.riders.join('・'))}` : ''}${
      inc.note ? `<br>状況：${esc(inc.note)}` : ''}</p>
    ${dialButtons(kindOf(inc.kind)?.dial ?? [])}
    ${phoneSection(o.config)}
    <p class="sub">✅ 終わったら</p>
    <label class="fld"><span>解決の内容（任意）</span>
      <input name="closeNote" placeholder="例：保護者が先に迎えに来ていた" autocomplete="off"></label>
    <button type="button" class="big" data-act="resolve" data-testid="resolve">✅ 解決した（全員の帯を消す）</button>
    <button type="button" class="link danger" data-act="cancel-incident" data-testid="cancel-incident">誤報だった（取り消す）</button>
    <button type="button" class="link" data-act="close">閉じる</button>`
  : `
    <h2 tabindex="-1">🚨 緊急</h2>
    <p class="sub">何が起きた？</p>
    <div class="sos-kinds">${INCIDENT_KINDS.map(k => `<button type="button" class="sos-kind"
      data-kind="${esc(k.id)}" data-testid="kind-${esc(k.id)}"><span>${k.icon}</span>${esc(k.id)}</button>`).join('')}</div>
    <p class="note sos-hint" data-hint hidden></p>
    <div data-dial></div>
    ${phoneSection(o.config)}
    <p class="sub">🚨 全員の画面に「緊急対応中」を出す</p>
    <p class="note">送迎記録と虎の巻の、すべての画面の先頭に赤い帯が出ます。
      <b>迷ったら出してください。</b>取り消しは簡単で、取り消したことも記録に残るだけです。</p>
    ${o.place ? '' : `<label class="fld"><span>どこで</span><select name="place">${
        [...o.config.schools, ...o.config.bases].map(p => `<option>${esc(p)}</option>`).join('')}</select></label>`}
    ${o.kids.length ? `<p class="note" style="margin-bottom:4px"><span data-kids-label>対象の児童</span>（任意）</p>
      <div class="kids">${o.kids.map(c => `<button type="button" class="kid" data-kid="${esc(c.alias)}">
        <b>${esc(c.alias)}</b><small>${esc(c.grade)}</small></button>`).join('')}</div>` : ''}
    <label class="fld"><span>状況（任意）</span>
      <input name="note" placeholder="何が起きたかを短く" autocomplete="off"></label>
    <button type="button" class="big danger" data-act="raise" data-testid="raise" disabled>上で「何が起きた？」を選んでください</button>
    <button type="button" class="link" data-act="close">閉じる</button>`;

  d.innerHTML = `<form method="dialog"><div class="fields">${body}</div></form>`;
  document.body.appendChild(d);
  d.addEventListener('close', () => d.remove());
  d.showModal();
  d.querySelector<HTMLElement>('h2')!.focus();

  const q = <T extends HTMLElement>(sel: string) => d.querySelector<T>(sel);
  const val = (name: string) => q<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`)?.value.trim() ?? '';

  // 連絡先を切り替えたら、発信ボタンの宛先も変える
  const sel = q<HTMLSelectElement>('[name=contact]'), call = q<HTMLAnchorElement>('[data-testid=call]');
  if (sel && call) sel.onchange = () => {
    const c = o.config.contacts.filter(x => x.phone)[Number(sel.value)];
    if (c) { call.href = `tel:${c.phone}`; call.textContent = `📞 ${c.name} に電話する`; }
  };

  // 種別を選ぶと、救急・警察のボタン、注意書き、児童の見出し、入力例が切り替わる
  let kind = '';
  d.querySelectorAll<HTMLElement>('[data-kind]').forEach(b => b.onclick = () => {
    kind = b.dataset.kind!;
    const k = kindOf(kind)!;
    d.querySelectorAll<HTMLElement>('[data-kind]').forEach(x => x.classList.toggle('on', x === b));
    const hint = q<HTMLElement>('[data-hint]')!;
    hint.textContent = k.hint; hint.hidden = !k.hint;
    q<HTMLElement>('[data-dial]')!.innerHTML = dialButtons(k.dial);
    const kl = q<HTMLElement>('[data-kids-label]'); if (kl) kl.textContent = k.kids;
    q<HTMLInputElement>('[name=note]')!.placeholder = k.placeholder;
    const raise = q<HTMLButtonElement>('[data-act=raise]')!;
    raise.disabled = false; raise.textContent = `🚨 緊急対応中にする（${kind}）`;
  });

  const picked = new Set<string>();
  d.querySelectorAll<HTMLElement>('[data-kid]').forEach(b => b.onclick = () => {
    const k = b.dataset.kid!;
    if (picked.has(k)) picked.delete(k); else picked.add(k);
    b.classList.toggle('on', picked.has(k));
  });

  q('[data-act=close]')?.addEventListener('click', () => d.close());
  q('[data-act=raise]')?.addEventListener('click', () => {
    if (!kind) return;
    if (!confirm(`全員の画面に「緊急対応中：${kind}」を表示します。よろしいですか？`)) return;
    o.raise({ kind, driver: o.who, vehicle: o.vehicle, place: o.place || val('place'),
              riders: [...picked], note: val('note') });
    d.close();
  });
  q('[data-act=resolve]')?.addEventListener('click', () => {
    if (!inc) return;
    o.close(inc.id, 'resolved', val('closeNote'));
    d.close();
  });
  q('[data-act=cancel-incident]')?.addEventListener('click', () => {
    if (!inc) return;
    if (!confirm('誤報として取り消します。取り消したことも記録に残ります。よろしいですか？')) return;
    o.close(inc.id, 'cancelled', val('closeNote'));
    d.close();
  });
}
