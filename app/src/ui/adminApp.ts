/** 管理者向けの画面。3つのことをする。
 *   1. いまの運行状況を時系列で見る（運行管理担当が一目で把握するため）
 *   2. おかしい記録をその場で直す（見えるだけでなく直せること）
 *   3. 月次の帳票を作る（印刷／PDF と Excel）
 */
import type { AlcoholCheck, Config, Finding, Trip } from '../domain/types';
import type { Snapshot, Store } from '../store/store';
import { InputError } from '../store/store';
import { buildBoard } from '../domain/status';
import { buildReview } from '../domain/review';
import { REPORT, reportFilename, reportSheets, type ReportKind, type Source } from '../domain/sheets';
import { renderBoard } from './board';
import { renderTimeline, attachTooltip } from './timeline';
import { openAlcoholEditor, openConfigEditor, openTripEditor } from './edit';
import { printSheets } from './print';
import { toast } from './toast';
import { buildXlsx, download } from '../export/xlsx';
import { hhmm, today } from '../store/clock';
import { ALERT } from '../config';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** 指摘ごとに、直す場所へ直接飛ばす */
const fixButton = (f: Finding) =>
  f.fix.kind === 'trip' ? `<button class="mini" data-fix-trip="${esc(f.fix.id)}">運行を直す</button>`
  : f.fix.kind === 'alcohol' ? `<button class="mini" data-fix-alc="${esc(f.fix.id)}">記録を直す</button>`
  : `<button class="mini" data-act="config">設定を開く</button>`;

type Tab = 'board' | 'report';

/** 画面を描き直す間隔。時計と経過時間を進めるためだけに使う */
const REFRESH_MS = 30_000;

export class AdminApp {
  private snap: Snapshot | null = null;
  private tab: Tab = 'board';
  private month = today().slice(0, 7);
  private data: { trips: Trip[]; checks: AlcoholCheck[] } | null = null;
  private loading = false;
  private banner: string;

  constructor(private root: HTMLElement, private store: Store, banner = '') {
    this.banner = banner;
    store.subscribe(s => { this.snap = s; this.render(); });
    attachTooltip(root);
    // 記録に動きが無くても、経過時間と「現在」の線は進める。
    // これが無いと、開きっぱなしの画面が止まって見える。
    setInterval(() => {
      if (this.tab === 'board' && !document.querySelector('dialog[open]')) this.render();
    }, REFRESH_MS);
  }

  private get config(): Config { return this.snap!.config; }

  /** 直せなかったときは理由を出す。黙って消えるのがいちばん困る */
  private async run(fn: () => Promise<void>, done: string) {
    try { await fn(); toast(done); }
    catch (e) {
      if (e instanceof InputError) alert(`直せませんでした。\n\n${e.message}`);
      else toast('保存できませんでした');
    }
    if (this.tab === 'report') await this.loadMonth(true);
  }

  private render() {
    if (!this.snap) { this.root.innerHTML = '<p class="boot">読み込み中…</p>'; return; }
    this.root.innerHTML = this.banner + this.nav() + this.setupNotice() +
      (this.tab === 'board' ? this.viewBoard() : this.viewReport());
    this.bind();
  }

  /** 運転者・車両がまだ仮の名前のときに、一度だけ気づいてもらうための案内。
   *  実名はコードに書かず、ここから登録して Firestore に保存する。 */
  private setupNotice() {
    if (this.snap!.configured) return '';
    return `<div class="notice" data-testid="setup-notice">
      <b>運転者と車両が仮の名前のままです</b>
      <span>「設定」を開いて、実際の運転者名・車両名・自動車登録番号を登録してください。
        以後の追加や変更も、ここから行えます。</span>
      <button class="mini" data-act="config">設定を開く</button></div>`;
  }

  private nav() {
    const t = (k: Tab, label: string) =>
      `<button class="tab${this.tab === k ? ' on' : ''}" data-tab="${k}">${label}</button>`;
    return `<nav class="tabs">${t('board', '運行状況')}${t('report', '月次帳票')}
      <span class="sp"></span>
      <button class="tab" data-act="config">設定</button></nav>`;
  }

  // ------------------------------------------------------------ 運行状況

  private viewBoard() {
    const s = this.snap!;
    const now = hhmm();
    const board = buildBoard(s.trips, s.checks, now, ALERT);
    return renderTimeline(board.lanes, now) + renderBoard(board, s.today, now) + this.fixList();
  }

  /** その日の記録を1件ずつ直せるようにする。時系列の表からは直接たどれないため */
  private fixList() {
    const s = this.snap!;
    const trips = [...s.trips].sort((a, b) => a.departAt.localeCompare(b.departAt));
    return `<section><h2>記録を直す（本日）</h2>
      <div class="tablewrap"><table><thead><tr>
        <th>出発</th><th>車両</th><th>運転者</th><th>状態</th><th>内容</th><th></th></tr></thead>
        <tbody>${trips.length ? trips.map(t => `<tr data-testid="trip-fix-row">
          <td class="num">${esc(t.departAt)}</td>
          <td class="name">${esc(t.vehicle)}</td><td class="name">${esc(t.driver)}</td>
          <td class="name">${t.status === 'running' ? '運行中' : '完了'}</td>
          <td>${esc(t.stops.map(x => `${x.school} ${x.arriveAt}→${x.departAt || '（未）'}`).join(' ／ ') || '立ち寄りなし')}</td>
          <td><button class="mini" data-fix-trip="${esc(t.id)}">修正</button></td></tr>`).join('')
          : `<tr><td class="empty" colspan="6">本日の運行はまだありません</td></tr>`}</tbody></table></div>

      <h2 style="margin-top:16px">アルコールチェックを直す（本日）</h2>
      <div class="tablewrap"><table><thead><tr>
        <th>時刻</th><th>運転者</th><th>種別</th><th>結果</th><th></th></tr></thead>
        <tbody>${s.checks.length ? s.checks.map(c => `<tr data-testid="check-fix-row">
          <td class="num">${esc(c.at)}</td><td class="name">${esc(c.driver)}</td>
          <td class="name">${esc(c.kind)}</td><td class="num">${esc(c.result)}</td>
          <td><button class="mini" data-fix-alc="${esc(c.id)}">修正</button></td></tr>`).join('')
          : `<tr><td class="empty" colspan="5">本日の記録はまだありません</td></tr>`}</tbody></table></div>
      <button class="mini" data-act="add-alc" style="margin-top:10px">＋ アルコールチェックを追記</button>
    </section>`;
  }

  // ------------------------------------------------------------ 月次帳票

  private async loadMonth(quiet = false) {
    this.loading = !quiet;
    if (!quiet) this.render();
    try { this.data = await this.store.loadMonth(this.month); }
    catch { toast('その月の記録を読み込めませんでした'); this.data = null; }
    this.loading = false;
    this.render();
  }

  private source(): Source | null {
    return this.data ? { ...this.data, config: this.config, ym: this.month } : null;
  }

  private viewReport() {
    if (this.loading || !this.data)
      return `<p class="boot">${this.loading ? '読み込み中…' : ''}</p>`;
    const src = this.source()!;
    const findings = buildReview(src.trips, src.checks, src.config, src.ym);
    const bad = findings.filter(f => f.severity === '要確認').length;

    const card = (k: ReportKind) => `<div class="rep">
      <div><b>${esc(REPORT[k].label)}</b><small>${esc(REPORT[k].note)}</small></div>
      <div class="acts">
        <button class="mini" data-print="${k}">印刷 / PDF</button>
        <button class="mini" data-xlsx="${k}">Excel</button>
      </div></div>`;

    return `<div class="board-head">
      <h1>月次帳票</h1>
      <span class="pill ${bad ? 'ng' : 'ok'}" data-testid="findings">${
        bad ? `⚠ 要確認 ${bad}件` : '✓ 要確認なし'}</span>
      <span class="when"><input type="month" id="ym" value="${esc(this.month)}"></span>
    </div>
    <section><h2>帳票</h2>${(['insurance', 'alcohol', 'trips', 'review'] as ReportKind[]).map(card).join('')}
      <p class="note">「印刷 / PDF」はブラウザの印刷画面が開きます。送信先で「PDFに保存」を選べばそのまま提出できます（A4・余白・見出しの繰り返しは設定済み）。</p>
    </section>

    <section><h2>提出前の要確認（${findings.length}件）</h2>
      <div class="tablewrap"><table><thead><tr>
        <th>区分</th><th>日付</th><th>対象</th><th>内容</th><th>対応</th><th></th></tr></thead>
        <tbody>${findings.length ? findings.map(f => `<tr class="${f.severity === '要確認' ? 'alert' : ''}">
          <td class="name">${f.severity === '要確認' ? '⚠ 要確認' : '確認推奨'}</td>
          <td class="num">${esc(f.date)}</td><td class="name">${esc(f.subject)}</td>
          <td>${esc(f.what)}</td><td class="note">${esc(f.how)}</td>
          <td>${fixButton(f)}</td></tr>`).join('')
          : `<tr><td class="empty" colspan="6">指摘はありません。このまま提出できます。</td></tr>`}</tbody></table></div>
    </section>`;
  }

  // -------------------------------------------------------------- 操作

  private tripById(id: string): Trip | undefined {
    return this.snap!.trips.find(t => t.id === id) ?? this.data?.trips.find(t => t.id === id);
  }
  private checkById(id: string): AlcoholCheck | undefined {
    return this.snap!.checks.find(c => c.id === id) ?? this.data?.checks.find(c => c.id === id);
  }

  /**
   * 運行を削除する。アルコールチェックは運行に紐づかない独立した法定記録なので、
   * 自動では消さない（1日に何回運行してもチェックは1組だし、運転しなかった日でも
   * 実施したなら記録は残る）。ただし、その運転者の運行が1件も無くなる場合は
   * 試し入力の可能性が高いので、まとめて消すかどうかをここで聞く。
   */
  private removeTrip(t: Trip) {
    const others = this.snap!.trips.filter(x => x.id !== t.id && x.driver === t.driver);
    const checks = this.snap!.checks.filter(c => c.driver === t.driver);
    this.run(async () => {
      await this.store.cancelTrip(t.id);
      if (others.length || !checks.length) return;
      const ok = confirm(
        `${t.driver} さんの本日の運行は、これで1件も無くなります。\n`
        + `アルコールチェックの記録が ${checks.length}件 残ります。\n\n`
        + `これも削除しますか？\n\n`
        + `・試し入力だった → OK（削除する）\n`
        + `・実際に確認を行った → キャンセル（記録簿に残す）`);
      if (!ok) return;
      for (const c of checks) await this.store.deleteAlcohol(c.id);
    }, '運行を削除しました');
  }

  private bind() {
    const on = (sel: string, fn: (el: HTMLElement) => void) =>
      this.root.querySelectorAll<HTMLElement>(sel).forEach(el => el.onclick = () => fn(el));

    on('[data-tab]', el => {
      this.tab = el.dataset.tab as Tab;
      if (this.tab === 'report' && !this.data) this.loadMonth(); else this.render();
    });

    on('[data-act=config]', () => openConfigEditor(this.config, {
      save: c => this.run(() => this.store.saveConfig(c), '設定を保存しました'),
    }));

    on('[data-fix-trip]', el => {
      const t = this.tripById(el.dataset.fixTrip!);
      if (!t) return toast('その運行は見つかりませんでした');
      openTripEditor(t, this.config, {
        save: patch => this.run(() => this.store.editTrip(t.id, patch), '運行を修正しました'),
        remove: () => this.removeTrip(t),
      });
    });

    on('[data-fix-alc]', el => {
      const c = this.checkById(el.dataset.fixAlc!);
      if (!c) return toast('その記録は見つかりませんでした');
      openAlcoholEditor(c, this.config, this.snap!.today, {
        save: rec => this.run(() => this.store.editAlcohol(c.id, rec), '記録を修正しました'),
        remove: () => this.run(() => this.store.deleteAlcohol(c.id), '記録を削除しました'),
      });
    });

    on('[data-act=add-alc]', () => openAlcoholEditor(null, this.config, this.snap!.today, {
      save: rec => this.run(() => this.store.addAlcohol(rec), '記録を追記しました'),
    }));

    on('[data-print]', el => {
      const k = el.dataset.print as ReportKind;
      const src = this.source(); if (!src) return;
      printSheets(reportSheets(k, src),
        `よみたん放課後キャンパス　送迎記録　${this.month}　作成 ${today()} ${hhmm()}`);
    });

    on('[data-xlsx]', el => {
      const k = el.dataset.xlsx as ReportKind;
      const src = this.source(); if (!src) return;
      download(buildXlsx(reportSheets(k, src)), reportFilename(k, this.month));
      toast('Excel をダウンロードしました');
    });

    const ym = this.root.querySelector<HTMLInputElement>('#ym');
    if (ym) ym.onchange = () => { this.month = ym.value; this.loadMonth(); };
  }
}
