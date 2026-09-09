/** 運転手用の画面。Apps Script 版の運用で分かった制約をそのまま持ち込む。
 *  - 運転前チェックを記録するまで出発できない（検査してから運転する順序どおりにしか記録させない）
 *  - 運転前が無いあいだは運転後を記録できない
 *  - 乗車人数を選ぶまで学校を出発できない
 *  - どの画面からでも運行をリセットできる */
import type { AlcoholCheck, Child, Config, Trip } from '../domain/types';
import { InputError, type Snapshot, type Store } from '../store/store';
import { normResult, normSchool } from '../domain/time';
import { totalCount } from '../domain/reports';
import { toast } from './toast';
import { openAlcoholQuick, openTripEditor } from './edit';
import { buildBoard } from '../domain/status';
import { renderBoard } from './board';
import { renderTimeline, attachTooltip } from './timeline';
import { ALERT } from '../config';
import { removeTripAndAsk } from './remove';
import { BUILD } from '../config';
import { hhmm } from '../store/clock';

const DRIVER_KEY = 'yd-driver', VEHICLE_KEY = 'yd-vehicle', BASE_KEY = 'yd-base';
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

type Picking = null | 'driver' | 'vehicle';
/** 運転手アプリの表示。記録は自分の操作、運行状況は全車両を見るだけ */
type View = 'record' | 'board';

/** 「未送信」を出すまでの猶予。通常の保存はこれより速く届くので、画面に出さない */
const PENDING_GRACE_MS = 5000;

export class App {
  private snap: Snapshot | null = null;
  private driver = localStorage.getItem(DRIVER_KEY) ?? '';
  private vehicle = localStorage.getItem(VEHICLE_KEY) ?? '';
  private picking: Picking = null;
  private selCount: number | null = null;
  /** 学校で選んだ児童（正式な氏名）。画面を離れるとき捨てる */
  private picked = new Set<string>();
  private noRider = false;
  private returning = false;
  private view: View = 'record';
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
    if (this.view === 'board') return this.renderBoardView();
    if (!this.snap) { this.root.innerHTML = '<p class="note">読み込み中…</p>'; return; }
    if (this.picking) return this.renderPicker(this.picking);

    const t = this.myTrip();
    const body = !this.driver || !this.vehicle ? this.viewSetup()
      : this.returning && t ? this.viewReturn(t)
      : t ? (this.openStop(t) ? this.viewAtSchool(t) : this.viewEnroute(t))
      : this.viewIdle();

    this.root.innerHTML = this.header() + body
      + `<p class="build">版 ${esc(BUILD)}</p>`;
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

  /** 全車両の運行状況。運転手は読むだけ（直す導線は出さない）。
   *  Firestore のルール上も運転手は読み取りができるので、追加の権限は要らない。 */
  private renderBoardView() {
    if (!this.snap) { this.root.innerHTML = '<p class="note">読み込み中…</p>'; return; }
    const now = hhmm();
    const board = buildBoard(this.snap.trips, this.snap.checks, now, ALERT);
    // アルコールチェックの数値は本人と管理者だけが見るものとし、
    // 運転手の画面では自分のぶんだけ出す。要確認の件数も、見えているものに合わせる
    const mine = board.alcohol.filter(a => a.driver === this.driver);
    const view = { ...board, alcohol: mine,
      alerts: board.running.filter(r => r.worries.length).length + mine.filter(a => a.ng).length };

    this.root.innerHTML = this.header()
      + renderTimeline(view.lanes, now, { editable: false })
      + renderBoard(view, this.snap.today, now, { editable: false })
      + `<p class="note" style="text-align:center">見るだけの画面です。
          アルコールチェックは自分のぶんだけ表示しています。<br>
          記録の修正は「記録」から行えます。</p>`
      + `<p class="build">版 ${esc(BUILD)}</p>`;
    this.bind();
    attachTooltip(this.root);
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
      </div>
      <nav class="tabs">
        <button class="tab${this.view === 'record' ? ' on' : ''}" data-view="record">記録</button>
        <button class="tab${this.view === 'board' ? ' on' : ''}" data-view="board">運行状況</button>
      </nav>`;
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
        <span class="status${ng ? ' ng' : ''}" data-testid="alc-${kind}">${
          ng ? `⚠ ${esc(rec.result)}` : '✓ 0.00'}　${esc(rec.at)}${
          rec.method && rec.method !== '対面' ? `　${esc(rec.method)}` : ''}${
          rec.photo ? '　📷' : ''}</span>
        <button class="mini" data-undo="${kind}">取消</button></div>`;
    }
    if (locked)
      return `<div class="row"><span class="label">${kind}</span>
        <span class="status locked" data-testid="alc-${kind}">運転前を記録してから</span></div>`;
    return `<div class="row"><span class="label">${kind}</span>
      <button class="go" data-quick="${kind}" data-testid="alc-record-${kind}">✓ 0.00 で記録</button></div>
      <div class="row sub"><button class="mini" data-detail="${kind}"
        data-testid="alc-detail-${kind}">0.00 以外・別の方法で記録</button></div>`;
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
    // 最後に拠点へ戻った時刻。運転を終える判断のよりどころになる
    const lastBack = mine.map(t => t.returnAt).filter(Boolean).sort().slice(-1)[0] ?? '';
    // 運転後を記録したあとにもう1度運転したら、記録し直しが要る。
    // 取り消しは求めない（記録簿は最後の運転後を採るので、上書きでよい）
    const postStale = !!post && !!lastBack && post.at < lastBack;

    // 運行が1件も無いのに運転後まで記録されている状態。運行を消したときに起きる。
    // 「終了しました」と出すのは実態と合わないので、別の段階として扱う
    const orphan = done === 0 && !!post;
    // 検知器に数値が出ている状態。運行させてはいけない
    const detected = !!pre && normResult(pre.result) !== '0.00';

    const step = !pre ? 'before'
      : detected ? 'detected'
      : orphan ? 'orphan'
      : (!post || postStale) ? (done ? 'driving' : 'ready')
      : 'finished';

    let h = `<div class="today" data-testid="today" data-step="${step}">
      <b>${{
        before: '① 運転前のアルコールチェックから',
        ready: '② 出発できます',
        driving: `② 本日 ${done}回 運行しました${lastBack ? `（最後に拠点へ戻ったのは ${esc(lastBack)}）` : ''}`,
        finished: '✅ 本日の運転は終了しました',
        orphan: '⚠ 本日の運行がありません',
        detected: `⚠ アルコールが検出されています（${esc(pre?.result ?? '')}）`,
      }[step]}</b>
      <span>${{
        before: '検知器で測ってから記録してください',
        ready: '運転を終えるときに、運転後のチェックを記録します',
        driving: postStale
          ? 'その後もう1度運転しているので、<b>運転後のチェックを記録し直してください</b>（最後の記録が採用されます）'
          : '運転を終えるときは、<b>必ず運転後のアルコールチェックを記録</b>してください（法定の記録です）',
        finished: `運転後 ${esc(post?.at ?? '')} に記録済み。おつかれさまでした`,
        orphan: 'アルコールチェックの記録だけが残っています。試し入力なら下から削除してください',
        detected: '<b>この状態で運転してはいけません。</b>運行管理担当に連絡してください。'
          + '入力を間違えた場合は、下の「取消」からやり直せます',
      }[step]}</span></div>`;

    h += `<div class="card"><h2>アルコールチェック（1日の最初と最後の2回）</h2>
      ${this.alcoholRow('運転前', false)}${this.alcoholRow('運転後', !pre)}
      <p class="note"><b>0.00</b> はアルコール検知器の表示です。検知器が <b>0.00</b> なら
        「✓ 0.00 で記録」をタップ。時刻と確認者は自動で入ります。</p></div>`;

    if (step === 'detected') {
      h += `<button class="big" data-testid="depart" disabled>🚐 出発する</button>
        <p class="note" style="text-align:center">
          検知器の表示が 0.00 でないため、出発できません。</p>`;
    } else if (step === 'orphan') {
      // 運行が無いのにチェックだけ残っている。消すか、もう1度出発するかを選ばせる
      h += `<button class="big secondary danger" data-testid="clear-alc">
        🗑 本日のアルコールチェックを削除する</button>
        <p class="note" style="text-align:center">運行の記録がないため、この記録簿は実態と合いません。
          実際に確認を行っていた場合は削除せず、そのまま出発してください。</p>
        <button class="big" data-testid="depart">🚐 出発する</button>`;
    } else if (step === 'before') {
      h += `<button class="big" data-testid="depart" disabled>🚐 出発する</button>
        <p class="note" style="text-align:center">先に上の「運転前」を記録してください。</p>`;
    } else if (step === 'finished') {
      // 運転後のあとでも、そのまま出発してよい。戻ってきたら記録し直せばよく、
      // 記録簿には最後の運転後が載る（取り消しの手間を求めない）
      h += `<button class="big secondary" data-testid="depart">🚐 もう1度 出発する（本日 ${done + 1} 回目）</button>
        <p class="note" style="text-align:center">
          出発できます。戻ったあとに、運転後のチェックをもう1度記録してください。</p>`;
    } else {
      h += `<button class="big" data-testid="depart">🚐 ${done ? `もう1度 出発する（本日 ${done + 1} 回目）` : '出発する'}</button>`;
      if (done) h += `<button class="big secondary" data-testid="alc-record-運転後-main"
        data-quick="運転後">🏁 本日の運転を終える${postStale ? '（記録し直す）' : ''}</button>
        <p class="note" style="text-align:center">運転後のアルコールチェックを記録します</p>`;
    }

    // 本日の運行。自分が運転したものは、その場で直せる（前日以前は管理者が直す）
    const all = this.snap!.trips.filter(t => t.status === 'done');
    if (all.length) h += `<div class="card"><h2>本日の運行（全車両）</h2>${all.map(t => {
      const via = t.stops.map(x => {
        if (!x.count) return `${x.school} 乗車なし`;
        // 児童を登録していれば呼び名、していなければ人数
        return `${x.school} ${x.riders?.length ? x.riders.map(r => r.alias).join('・') : `${x.count}人`}`;
      }).join(' → ') || '立ち寄りなし';
      return `<div class="log">
        <span class="body">
          <span class="time">${esc(t.departAt)}〜${esc(t.returnAt)}　${esc(t.vehicle)}・${esc(t.driver)}</span>
          <span class="desc">${esc(via)}　<b>合計 ${totalCount(t)}人</b></span>
        </span>${
        t.driver === this.driver ? `<button class="mini" data-fix="${esc(t.id)}">修正</button>` : ''
      }</div>`;
    }).join('')}
      <p class="note">自分が運転したぶんは「修正」から直せます（本日ぶんのみ）。</p></div>`;
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

  /** その学校で乗る児童。学校名の表記ゆれ（渡慶次小／渡慶次小学校）を吸収する */
  private childrenAt(school: string): Child[] {
    const key = normSchool(school);
    const all = this.config.children.filter(c => c.active);
    const here = all.filter(c => normSchool(c.school) === key);
    // その学校の登録が無ければ、全員を出す（登録漏れで記録できなくならないように）
    return here.length ? here : all;
  }

  private viewAtSchool(t: Trip) {
    const stop = this.openStop(t)!;
    const kids = this.childrenAt(stop.school);
    let h = `<div class="banner go" data-testid="at-school">📍 ${esc(stop.school)}<span class="t">到着 ${esc(stop.arriveAt)}</span></div>`;

    if (kids.length) {
      // 誰が乗ったかを名前で選ぶ。人数は選んだ数から決まる
      const n = this.picked.size;
      h += `<div class="card"><h2>乗せた児童をタップ（${esc(stop.school)}）</h2>
        <div class="kids">${kids.map(c => `<button class="kid${this.picked.has(c.name) ? ' on' : ''}"
          data-kid="${esc(c.name)}"><b>${esc(c.alias)}</b><small>${esc(c.grade)}</small></button>`).join('')}</div>
        <button class="big" data-testid="board"${n || this.noRider ? '' : ' disabled'}>${
          n ? `🚐 ${n}人 乗せて出発` : this.noRider ? '乗車なしで出発' : '乗せた児童を選んでください'}</button>
        <button class="big secondary${this.noRider ? ' on' : ''}" data-testid="no-rider">${
          this.noRider ? '✓ 乗車なし（選び直す）' : 'この学校では乗車なし'}</button>
        <p class="note">報告書には正式な氏名で載ります。ここは呼び名で選べます。</p></div>`;
    } else {
      // 児童が未登録のあいだは、これまでどおり人数で記録できる
      h += `<div class="card"><h2>乗せた人数をタップ</h2><div class="counts">`;
      for (let i = 1; i <= 8; i++) h += `<button data-count="${i}"${this.selCount === i ? ' class="on"' : ''}>${i}</button>`;
      h += `<button class="zero${this.selCount === 0 ? ' on' : ''}" data-count="0">乗車なし（0人）</button></div>
        <button class="big" data-testid="board"${this.selCount !== null ? '' : ' disabled'}>${
          this.selCount !== null ? (this.selCount > 0 ? `🚐 ${this.selCount}人 乗せて出発` : '乗車なしで出発') : '人数を選んでください'}</button>
        <p class="note">児童を「設定」に登録すると、ここで名前を選べるようになります。</p></div>`;
    }

    h += `<button class="link" data-testid="undo">↩ 到着を取り消す（学校を間違えた）</button>
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
      <label class="memo"><span>メモ（任意）</span>
        <textarea data-testid="note" rows="2"
          placeholder="遅れの理由、道路の状況など"></textarea>
        <small>ヒヤリハットは専用フォームへ。ここは運行の補足に使ってください</small></label>
      <button class="big" data-testid="finish">記録して終了</button>
      <button class="link" data-testid="return-cancel">戻る</button></div>`;
  }

  private bind() {
    const q = <T extends HTMLElement>(sel: string) => this.root.querySelector<T>(sel);
    this.root.querySelectorAll<HTMLElement>('[data-view]').forEach(b => b.onclick = () => {
      this.view = b.dataset.view as View; this.render();
    });
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
    this.root.querySelectorAll<HTMLElement>('[data-detail]').forEach(b => b.onclick = () => {
      const kind = b.dataset.detail as AlcoholCheck['kind'];
      openAlcoholQuick(kind, this.config, {
        save: v => this.run(() => this.store.recordAlcohol({
          kind, driver: this.driver, vehicle: this.vehicle,
          result: v.result, inspection: v.inspection, note: v.note,
          checker: this.config.inspectors[0] ?? '', method: v.method, photoData: v.photoData,
        }), `${kind}チェックを記録`),
      });
    });
    this.root.querySelectorAll<HTMLElement>('[data-undo]').forEach(b => b.onclick = () => {
      this.run(() => this.store.undoAlcohol(b.dataset.undo as AlcoholCheck['kind'], this.driver), '取り消しました');
    });

    q('[data-testid=clear-alc]')?.addEventListener('click', () => {
      const mine = this.snap!.checks.filter(c => c.driver === this.driver);
      if (!confirm(
        `本日のアルコールチェックの記録 ${mine.length}件 を削除します。\n\n`
        + '実際に確認を行った記録であれば、削除しないでください（1年間の保存義務があります）。\n\n'
        + '削除してよろしいですか？')) return;
      this.run(async () => {
        for (const kind of ['運転後', '運転前'] as const)
          for (const c of mine.filter(x => x.kind === kind)) await this.store.deleteAlcohol(c.id);
      }, 'アルコールチェックを削除しました');
    });

    q('[data-testid=depart]')?.addEventListener('click', () => {
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
    this.root.querySelectorAll<HTMLElement>('[data-kid]').forEach(b => b.onclick = () => {
      const name = b.dataset.kid!;
      if (this.picked.has(name)) this.picked.delete(name); else this.picked.add(name);
      this.noRider = false;
      this.render();
    });
    q('[data-testid=no-rider]')?.addEventListener('click', () => {
      this.noRider = !this.noRider;
      if (this.noRider) this.picked.clear();
      this.render();
    });
    q('[data-testid=board]')?.addEventListener('click', () => {
      if (!t) return;
      const open = this.openStop(t);
      const kids = open ? this.childrenAt(open.school) : [];
      if (kids.length) {
        if (!this.picked.size && !this.noRider) return;
        const riders = kids.filter(c => this.picked.has(c.name)).map(c => ({ name: c.name, alias: c.alias }));
        this.picked.clear(); this.noRider = false;
        this.run(() => this.store.departSchool(t.id, riders),
          riders.length ? `${riders.map(r => r.alias).join('・')} の乗車を記録` : '出発を記録');
      } else {
        if (this.selCount === null) return;
        const n = this.selCount; this.selCount = null;
        this.run(() => this.store.departSchool(t.id, [], n), n > 0 ? `${n}人の乗車を記録` : '出発を記録');
      }
    });
    q('[data-testid=return]')?.addEventListener('click', () => { this.returning = true; this.render(); });
    q('[data-testid=return-cancel]')?.addEventListener('click', () => { this.returning = false; this.render(); });
    this.root.querySelectorAll<HTMLElement>('.toggle').forEach(b => b.onclick = () => b.classList.toggle('on'));
    q('[data-testid=finish]')?.addEventListener('click', () => {
      if (!t) return;
      const on = (id: string) => q(`[data-testid=${id}]`)?.classList.contains('on') ?? false;
      const note = q<HTMLTextAreaElement>('[data-testid=note]')?.value.trim() ?? '';
      const input = { dest: this.config.bases[0] ?? '拠点', mokushi: on('mokushi'), handover: on('handover'), note };
      // 運転後を記録済みのまま、また運行した場合。閉じる前に気づいてもらう
      const post = this.check('運転後');
      this.returning = false;
      this.run(async () => {
        await this.store.finishTrip(t.id, input);
        if (post) alert(
          '運行を記録しました。\n\n'
          + `本日の「運転後」アルコールチェックは ${post.at} に記録済みですが、\n`
          + 'そのあとにこの運行をしています。\n\n'
          + '運転を終えるときは、「本日の運転を終える（記録し直す）」から\n'
          + 'もう1度記録してください。');
      }, '運行を記録しました');
    });
    this.root.querySelectorAll<HTMLElement>('[data-fix]').forEach(b => b.onclick = () => {
      const trip = this.snap!.trips.find(x => x.id === b.dataset.fix);
      if (!trip) return;
      openTripEditor(trip, this.config, {
        save: patch => this.run(() => this.store.editTrip(trip.id, patch), '記録を直しました'),
        // 誤って記録した運行は、その場で消せる（当日ぶんのみ。firestore.rules）
        remove: () => this.run(
          () => removeTripAndAsk(this.store, this.snap!, trip), '記録を削除しました'),
      });
    });

    q('[data-testid=undo]')?.addEventListener('click', () => {
      if (t) {
        this.selCount = null; this.picked.clear(); this.noRider = false;
        this.run(() => this.store.undoLast(t.id), '取り消しました');
      }
    });
    q('[data-testid=reset]')?.addEventListener('click', () => {
      if (!t) return;
      if (!confirm('この運行の記録をすべて破棄して、出発前の状態に戻します。よろしいですか？\n（確定済みの過去の運行は消えません）')) return;
      this.selCount = null; this.picked.clear(); this.noRider = false;
      this.run(() => this.store.cancelTrip(t.id), '運行をリセットしました');
    });
  }
}
