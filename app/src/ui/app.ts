/** 運転手用の画面。Apps Script 版の運用で分かった制約をそのまま持ち込む。
 *  - 運転前チェックを記録するまで出発できない（検査してから運転する順序どおりにしか記録させない）
 *  - 運転前が無いあいだは運転後を記録できない
 *  - 乗車人数を選ぶまで学校を出発できない
 *  - どの画面からでも運行をリセットできる */
import type { AlcoholCheck, Config, Trip } from '../domain/types';
import { InputError, type Snapshot, type Store } from '../store/store';
import { normResult } from '../domain/time';
import { totalCount } from '../domain/reports';
import { toast } from './toast';

const DRIVER_KEY = 'yd-driver', VEHICLE_KEY = 'yd-vehicle', BASE_KEY = 'yd-base';
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

type Picking = null | 'driver' | 'vehicle';

/** 「未送信」を出すまでの猶予。通常の保存はこれより速く届くので、画面に出さない */
const PENDING_GRACE_MS = 5000;

export class App {
  private snap: Snapshot | null = null;
  private driver = localStorage.getItem(DRIVER_KEY) ?? '';
  private vehicle = localStorage.getItem(VEHICLE_KEY) ?? '';
  private picking: Picking = null;
  private selCount: number | null = null;
  private returning = false;
  private busy = false;
  private pendingSince = 0;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;

  // ログインは入口（main.ts）で済んでいる。ここは記録だけを受け持つ
  constructor(private root: HTMLElement, private store: Store) {
    store.subscribe(s => { this.snap = s; this.watchPending(s.pending); this.render(); });
  }

  /** 送信中の状態を追う。すぐ届いたぶんは画面に出さない */
  private watchPending(pending: number) {
    if (pending === 0) {
      this.pendingSince = 0;
      if (this.pendingTimer) { clearTimeout(this.pendingTimer); this.pendingTimer = null; }
      return;
    }
    if (this.pendingSince) return;             // すでに数えている
    this.pendingSince = Date.now();
    this.pendingTimer = setTimeout(() => {     // 猶予を過ぎてもまだなら出す
      this.pendingTimer = null;
      this.render();
    }, PENDING_GRACE_MS);
  }

  private get config(): Config { return this.snap!.config; }
  private myTrip(): Trip | undefined {
    return this.snap?.trips.find(t => t.vehicle === this.vehicle && t.status === 'running');
  }
  private check(kind: AlcoholCheck['kind']): AlcoholCheck | undefined {
    return this.snap?.checks.filter(c => c.kind === kind && c.driver === this.driver).slice(-1)[0];
  }
  private openStop(t: Trip) {
    const last = t.stops[t.stops.length - 1];
    return last && !last.departAt ? last : undefined;
  }

  /** 記録できない操作は理由を出すだけ。再試行はしない（キューを詰まらせない） */
  private async run(fn: () => Promise<void>, done?: string) {
    if (this.busy) return;
    this.busy = true;
    try { await fn(); if (done) toast(done); }
    catch (e) {
      if (e instanceof InputError) alert(`この操作は記録できませんでした。\n\n${e.message}`);
      else toast('保存できませんでした。電波を確認してください');
    } finally { this.busy = false; this.render(); }
  }

  render() {
    if (!this.snap) { this.root.innerHTML = '<p class="note">読み込み中…</p>'; return; }
    if (this.picking) return this.renderPicker(this.picking);

    const t = this.myTrip();
    const body = !this.driver || !this.vehicle ? this.viewSetup()
      : this.returning && t ? this.viewReturn(t)
      : t ? (this.openStop(t) ? this.viewAtSchool(t) : this.viewEnroute(t))
      : this.viewIdle();

    this.root.innerHTML = this.header() + body;
    this.bind();
  }

  private renderPicker(kind: 'driver' | 'vehicle') {
    const list = kind === 'driver' ? this.config.drivers : this.config.vehicles.filter(v => v.active).map(v => v.name);
    this.root.innerHTML = this.header() + `<div class="card"><h2>${kind === 'driver' ? '運転者' : '車両'}を選ぶ</h2>${
      list.map(v => `<button class="school" data-pick="${esc(v)}">${esc(v)}</button>`).join('')
    }</div><button class="link" data-testid="pick-cancel">キャンセル</button>`;
    this.root.querySelectorAll<HTMLElement>('[data-pick]').forEach(b => b.onclick = () => {
      const v = b.dataset.pick!;
      if (kind === 'driver') { this.driver = v; localStorage.setItem(DRIVER_KEY, v); }
      else { this.vehicle = v; localStorage.setItem(VEHICLE_KEY, v); }
      this.picking = null; this.render();
    });
    this.root.querySelector('[data-testid=pick-cancel]')!.addEventListener('click', () => { this.picking = null; this.render(); });
  }

  private header() {
    // 電波が切れていても記録は端末に残る。ここは「まだ届いていない」ことだけを伝える。
    // ふつうの保存は一瞬で届くので、しばらく待っても届かないときだけ出す。
    const pending = this.snap?.pending ?? 0;
    const stuck = pending > 0 && this.pendingSince > 0
      && Date.now() - this.pendingSince >= PENDING_GRACE_MS;
    const sync = stuck
      ? `<p class="pending" data-testid="pending">📡 送信待ち ${pending}件　電波が戻ると自動で送られます。記録は消えないので、このまま続けて大丈夫です</p>`
      : '';
    return `<header><p class="logo">送迎記録<small>よみたん放課後キャンパス</small></p></header>${sync}
      <div class="picks">
        <button class="pick${this.driver ? '' : ' unset'}" data-testid="pick-driver"><small>運転者</small><b>${esc(this.driver || '選ぶ')}</b></button>
        <button class="pick${this.vehicle ? '' : ' unset'}" data-testid="pick-vehicle"><small>車両</small><b>${esc(this.vehicle || '選ぶ')}</b></button>
      </div>`;
  }

  private viewSetup() {
    return `<div class="card"><h2>はじめに</h2><p style="margin:0;font-weight:700">
      上の「運転者」「車両」をタップして選んでください。<br>
      <span class="note">次回からは自動で表示されます。</span></p></div>`;
  }

  /** アルコールチェック1行ぶん。記録済みなら時刻を残し、取消もできる */
  private alcoholRow(kind: AlcoholCheck['kind'], locked: boolean) {
    const rec = this.check(kind);
    if (rec) {
      const ng = normResult(rec.result) !== '0.00';
      return `<div class="row"><span class="label">${kind}</span>
        <span class="status${ng ? ' ng' : ''}" data-testid="alc-${kind}">${ng ? '⚠ 検出' : '✓ 0.00'}　${esc(rec.at)}</span>
        <button class="mini" data-undo="${kind}">取消</button></div>`;
    }
    if (locked)
      return `<div class="row"><span class="label">${kind}</span>
        <span class="status locked" data-testid="alc-${kind}">運転前を記録してから</span></div>`;
    return `<div class="row"><span class="label">${kind}</span>
      <button class="go" data-quick="${kind}" data-testid="alc-record-${kind}">✓ 0.00 で記録</button></div>`;
  }

  /**
   * 出発前の画面。1日の流れは「運転前チェック → 何回か運行 → 運転後チェック」で、
   * いまどこにいるかが一目で分かることを最優先にする。
   * 大きいボタンは常に「次にやること」1つだけにして、押し間違いと
   * 「記録できたのか分からない」を防ぐ。
   */
  private viewIdle() {
    const pre = this.check('運転前'), post = this.check('運転後');
    const mine = this.snap!.trips.filter(t => t.status === 'done' && t.driver === this.driver);
    const done = mine.length;

    // いまの段階。これを見出しに出す
    const step = !pre ? 'before' : !post ? (done ? 'driving' : 'ready') : 'finished';

    let h = `<div class="today" data-testid="today" data-step="${step}">
      <b>${{
        before: '① 運転前のアルコールチェックから',
        ready: '② 出発できます',
        driving: `② 本日 ${done}回 運行しました`,
        finished: '✅ 本日の運転は終了しました',
      }[step]}</b>
      <span>${{
        before: '検知器で測ってから記録してください',
        ready: '運転を終えるときに、運転後のチェックを記録します',
        driving: 'もう1度出発するか、運転を終えて運転後のチェックを記録します',
        finished: `運転後 ${esc(post?.at ?? '')} に記録済み。おつかれさまでした`,
      }[step]}</span></div>`;

    h += `<div class="card"><h2>アルコールチェック（1日の最初と最後の2回）</h2>
      ${this.alcoholRow('運転前', false)}${this.alcoholRow('運転後', !pre)}
      <p class="note"><b>0.00</b> はアルコール検知器の表示です。検知器が <b>0.00</b> なら
        「✓ 0.00 で記録」をタップ。時刻と確認者は自動で入ります。</p></div>`;

    if (step === 'before') {
      h += `<button class="big" data-testid="depart" disabled>🚐 出発する</button>
        <p class="note" style="text-align:center">先に上の「運転前」を記録してください。</p>`;
    } else if (step === 'finished') {
      // 運転後を記録したあとの出発は、記録の辻褄が合わなくなる。押しにくくして理由も出す
      h += `<button class="big secondary" data-testid="depart">🚐 もう1度 出発する</button>
        <p class="note" style="text-align:center">
          運転後のチェックを記録済みです。もう1度運転する場合は、
          上の「運転後」を取り消してから出発してください。</p>`;
    } else {
      h += `<button class="big" data-testid="depart">🚐 ${done ? `もう1度 出発する（本日 ${done + 1} 回目）` : '出発する'}</button>`;
      if (done) h += `<button class="big secondary" data-testid="alc-record-運転後-main"
        data-quick="運転後">🏁 本日の運転を終える</button>
        <p class="note" style="text-align:center">運転後のアルコールチェックを記録します</p>`;
    }

    const all = this.snap!.trips.filter(t => t.status === 'done');
    if (all.length) h += `<div class="card"><h2>本日の運行（全車両）</h2>${all.map(t =>
      `<div class="log"><span class="time">${esc(t.departAt)}〜${esc(t.returnAt)}</span>
        <span class="desc">${esc(t.vehicle)}・${esc(t.driver)}・${totalCount(t)}人</span></div>`).join('')}</div>`;
    return h;
  }

  private viewEnroute(t: Trip) {
    const boarded = totalCount(t);
    const visited = new Map(t.stops.filter(s => s.departAt).map(s => [s.school, `${s.arriveAt}→${s.departAt}`]));
    let h = `<div class="banner go" data-testid="enroute">🚐 運行中${boarded ? `　乗車 ${boarded}人` : ''}
      <span class="t">${esc(t.base)} ${esc(t.departAt)}発</span></div>`;
    if (t.stops.length) h += `<button class="big" data-testid="return">🏠 拠点に到着した</button>
      <p class="note" style="text-align:center">別の学校に立ち寄る場合は下から選択</p>`;
    else h += `<p class="note" style="font-weight:700;color:var(--ink)">学校に着いたらタップ</p>`;
    h += this.config.schools.map(s =>
      `<button class="school" data-school="${esc(s)}">${esc(s)}${visited.has(s) ? `<span class="done">✓ ${esc(visited.get(s))}</span>` : ''}</button>`).join('');
    if (!t.stops.length) h += `<button class="big secondary" data-testid="return">🏠 乗車なしで拠点に戻った</button>`;
    h += `<button class="link" data-testid="undo">↩ 直前の記録を取り消す</button>
      <button class="link danger" data-testid="reset">⟳ この運行をリセット（最初からやり直す）</button>`;
    return h;
  }

  private viewAtSchool(t: Trip) {
    const stop = this.openStop(t)!;
    const picked = this.selCount !== null;
    let h = `<div class="banner go" data-testid="at-school">📍 ${esc(stop.school)}<span class="t">到着 ${esc(stop.arriveAt)}</span></div>
      <div class="card"><h2>乗せた人数をタップ</h2><div class="counts">`;
    for (let i = 1; i <= 8; i++) h += `<button data-count="${i}"${this.selCount === i ? ' class="on"' : ''}>${i}</button>`;
    h += `<button class="zero${this.selCount === 0 ? ' on' : ''}" data-count="0">乗車なし（0人）</button></div>
      <button class="big" data-testid="board"${picked ? '' : ' disabled'}>${
        picked ? (this.selCount! > 0 ? `🚐 ${this.selCount}人 乗せて出発` : '乗車なしで出発') : '人数を選んでください'}</button>
      <p class="note">名簿・出欠の確認は別途行うので、ここは保険記録用の人数だけでOK。</p></div>
      <button class="link" data-testid="undo">↩ 到着を取り消す（学校を間違えた）</button>
      <button class="link danger" data-testid="reset">⟳ この運行をリセット（最初からやり直す）</button>`;
    return h;
  }

  private viewReturn(t: Trip) {
    return `<div class="card"><h2>拠点に到着</h2>
      <p style="margin:0 0 12px;font-weight:700">${esc(t.vehicle)}・${esc(t.driver)}・乗車 ${totalCount(t)}人</p>
      <button class="toggle on" data-testid="mokushi"><span class="box">✓</span>
        <span>車内の目視確認をした<small>置き去り防止。していない場合はタップして外す</small></span></button>
      <button class="toggle on" data-testid="handover"><span class="box">✓</span>
        <span>こどもを引き渡した<small>拠点の担当者に引き継いだ。していない場合はタップして外す</small></span></button>
      <button class="big" data-testid="finish">記録して終了</button>
      <button class="link" data-testid="return-cancel">戻る</button></div>`;
  }

  private bind() {
    const q = <T extends HTMLElement>(sel: string) => this.root.querySelector<T>(sel);
    q('[data-testid=pick-driver]')?.addEventListener('click', () => { this.picking = 'driver'; this.render(); });
    q('[data-testid=pick-vehicle]')?.addEventListener('click', () => { this.picking = 'vehicle'; this.render(); });

    this.root.querySelectorAll<HTMLElement>('[data-quick]').forEach(b => b.onclick = () => {
      const kind = b.dataset.quick as AlcoholCheck['kind'];
      this.run(() => this.store.recordAlcohol({
        kind, driver: this.driver, vehicle: this.vehicle, result: '0.00',
        inspection: kind === '運転前' ? '良' : '', note: '良好',
        checker: this.config.inspectors[0] ?? '', method: '対面',
      }), `${kind}チェックを記録`);
    });
    this.root.querySelectorAll<HTMLElement>('[data-undo]').forEach(b => b.onclick = () => {
      this.run(() => this.store.undoAlcohol(b.dataset.undo as AlcoholCheck['kind'], this.driver), '取り消しました');
    });

    q('[data-testid=depart]')?.addEventListener('click', () => {
      // 運転後を記録したあとに出発すると、記録簿の辻褄が合わなくなる。一度止める
      if (this.check('運転後') && !confirm(
        '本日の「運転後」アルコールチェックを記録済みです。\n\n'
        + 'このまま出発すると、記録簿の順序が合わなくなります。\n'
        + '運転後を取り消してから出発することをおすすめします。\n\nこのまま出発しますか？')) return;
      const base = localStorage.getItem(BASE_KEY) ?? this.config.bases[0] ?? '拠点';
      this.run(() => this.store.startTrip({ vehicle: this.vehicle, driver: this.driver, base }), '出発を記録');
    });

    const t = this.myTrip();
    this.root.querySelectorAll<HTMLElement>('[data-school]').forEach(b => b.onclick = () => {
      if (t) this.run(() => this.store.arriveSchool(t.id, b.dataset.school!), `${b.dataset.school} 到着を記録`);
    });
    this.root.querySelectorAll<HTMLElement>('[data-count]').forEach(b => b.onclick = () => {
      this.selCount = Number(b.dataset.count); this.render();
    });
    q('[data-testid=board]')?.addEventListener('click', () => {
      if (!t || this.selCount === null) return;
      const n = this.selCount; this.selCount = null;
      this.run(() => this.store.departSchool(t.id, n), n > 0 ? `${n}人の乗車を記録` : '出発を記録');
    });
    q('[data-testid=return]')?.addEventListener('click', () => { this.returning = true; this.render(); });
    q('[data-testid=return-cancel]')?.addEventListener('click', () => { this.returning = false; this.render(); });
    this.root.querySelectorAll<HTMLElement>('.toggle').forEach(b => b.onclick = () => b.classList.toggle('on'));
    q('[data-testid=finish]')?.addEventListener('click', () => {
      if (!t) return;
      const on = (id: string) => q(`[data-testid=${id}]`)?.classList.contains('on') ?? false;
      const input = { dest: this.config.bases[0] ?? '拠点', mokushi: on('mokushi'), handover: on('handover'), note: '' };
      this.returning = false;
      this.run(() => this.store.finishTrip(t.id, input), '運行を記録しました');
    });
    q('[data-testid=undo]')?.addEventListener('click', () => {
      if (t) { this.selCount = null; this.run(() => this.store.undoLast(t.id), '取り消しました'); }
    });
    q('[data-testid=reset]')?.addEventListener('click', () => {
      if (!t) return;
      if (!confirm('この運行の記録をすべて破棄して、出発前の状態に戻します。よろしいですか？\n（確定済みの過去の運行は消えません）')) return;
      this.selCount = null;
      this.run(() => this.store.cancelTrip(t.id), '運行をリセットしました');
    });
  }
}
