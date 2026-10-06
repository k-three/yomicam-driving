/** 緊急対応（こどもの所在が分からない、など）の入口。
 *
 *  やることは2つだけに絞ってある。
 *    1. 電話をかける（連絡先は設定で登録したもの。上から順に優先）
 *    2. 「緊急対応中」を立てる → 送迎記録・虎の巻のすべての画面の先頭に赤い帯が出る
 *
 *  帯は誰かが「解決」か「取り消し」を押すまで消えない。開始から解決までが
 *  1件の記録として残るので、あとから保護者への説明や事後報告に使える。
 *  迷ったら出してよい（取り消しも記録に残るだけで、罰にはならない）。 */
import type { Child, Config, Incident } from '../domain/types';
import type { IncidentInput } from '../store/store';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** 経過時間の文字。帯と画面で同じ言い回しにする */
export function elapsedText(sinceMs: number, nowMs = Date.now()): string {
  const min = Math.max(0, Math.floor((nowMs - sinceMs) / 60_000));
  return min < 60 ? `${min}分経過` : `${Math.floor(min / 60)}時間${min % 60}分経過`;
}

/** すべての画面の先頭に出す帯。無ければ空文字 */
export function incidentBanner(inc: Incident | null): string {
  if (!inc) return '';
  const who = [inc.driver, inc.vehicle, inc.place].filter(Boolean).join('・');
  const kids = inc.riders.length ? `　来ていない：${esc(inc.riders.join('・'))}` : '';
  return `<div class="sos-banner" role="alert" data-testid="sos-banner">
    <div class="sos-main">
      <b>🚨 緊急対応中</b>
      <span class="sos-time">${esc(inc.startedAt)}〜　<em data-since-ms="${inc.startedMs}">${elapsedText(inc.startedMs)}</em></span>
    </div>
    <div class="sos-detail">${esc(who)}${kids}${inc.note ? `　${esc(inc.note)}` : ''}</div>
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
  /** 「来ていない児童」の候補。学校にいるならその学校のこども */
  kids: Child[];
  raise: (input: IncidentInput) => void;
  close: (id: string, outcome: 'resolved' | 'cancelled', note: string) => void;
};

export function openEmergency(o: EmergencyOpts) {
  const d = document.createElement('dialog');
  d.className = 'editor sos';
  const inc = o.incident;

  const body = inc ? `
    <h2 tabindex="-1">🚨 緊急対応中</h2>
    <p class="who">${esc(inc.startedAt)}〜（<em data-since-ms="${inc.startedMs}">${elapsedText(inc.startedMs)}</em>）<br>
      ${esc([inc.driver, inc.vehicle, inc.place].filter(Boolean).join('・'))}${
      inc.riders.length ? `<br>来ていない：${esc(inc.riders.join('・'))}` : ''}${
      inc.note ? `<br>状況：${esc(inc.note)}` : ''}</p>
    ${phoneSection(o.config)}
    <p class="sub">✅ 終わったら</p>
    <label class="fld"><span>解決の内容（任意）</span>
      <input name="closeNote" placeholder="例：保護者が先に迎えに来ていた" autocomplete="off"></label>
    <button type="button" class="big" data-act="resolve" data-testid="resolve">✅ 解決した（全員の帯を消す）</button>
    <button type="button" class="link danger" data-act="cancel-incident" data-testid="cancel-incident">誤報だった（取り消す）</button>
    <button type="button" class="link" data-act="close">閉じる</button>`
  : `
    <h2 tabindex="-1">🚨 緊急</h2>
    ${phoneSection(o.config)}
    <p class="sub">🚨 全員の画面に「緊急対応中」を出す</p>
    <p class="note">送迎記録と虎の巻の、すべての画面の先頭に赤い帯が出ます。
      <b>迷ったら出してください。</b>取り消しは簡単で、取り消したことも記録に残るだけです。</p>
    ${o.place ? '' : `<label class="fld"><span>どこで</span><select name="place">${
        [...o.config.schools, ...o.config.bases].map(p => `<option>${esc(p)}</option>`).join('')}</select></label>`}
    ${o.kids.length ? `<p class="note" style="margin-bottom:4px">来ていない・所在が分からない児童（任意）</p>
      <div class="kids">${o.kids.map(c => `<button type="button" class="kid" data-kid="${esc(c.alias)}">
        <b>${esc(c.alias)}</b><small>${esc(c.grade)}</small></button>`).join('')}</div>` : ''}
    <label class="fld"><span>状況（任意）</span>
      <input name="note" placeholder="例：下校時刻を20分過ぎても来ない" autocomplete="off"></label>
    <button type="button" class="big danger" data-act="raise" data-testid="raise">🚨 緊急対応中にする</button>
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

  const picked = new Set<string>();
  d.querySelectorAll<HTMLElement>('[data-kid]').forEach(b => b.onclick = () => {
    const k = b.dataset.kid!;
    if (picked.has(k)) picked.delete(k); else picked.add(k);
    b.classList.toggle('on', picked.has(k));
  });

  q('[data-act=close]')?.addEventListener('click', () => d.close());
  q('[data-act=raise]')?.addEventListener('click', () => {
    if (!confirm('全員の画面に「緊急対応中」を表示します。よろしいですか？')) return;
    o.raise({ driver: o.who, vehicle: o.vehicle, place: o.place || val('place'),
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
