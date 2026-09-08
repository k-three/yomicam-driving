/** 管理者が記録を直すための入力欄。
 *  運行中の記録も確定済みの記録も同じ形（Trip）なので、同じ画面で直せる。
 *  Apps Script 版では運行中の状態が別シートの状態JSONだったため手で直せず、
 *  「おかしいと分かっても直せない」状態が起きていた。ここではそれが起きない。 */
import type { AlcoholCheck, Config, Stop, Trip } from '../domain/types';
import type { TripPatch } from '../store/store';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

const opts = (list: string[], sel: string) =>
  list.map(v => `<option value="${esc(v)}"${v === sel ? ' selected' : ''}>${esc(v)}</option>`).join('');

/** 一覧に無い値（過去の記録など）を選べるように、先頭に足しておく */
const withCurrent = (list: string[], v: string) => (v && !list.includes(v) ? [v, ...list] : list);

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function dialog(title: string, body: string, opt: { danger?: string } = {}): HTMLDialogElement {
  const d = document.createElement('dialog');
  d.className = 'editor';
  d.innerHTML = `<form method="dialog"><h2>${esc(title)}</h2>
    <div class="fields">${body}</div>
    <p class="err" data-err hidden></p>
    <menu>
      ${opt.danger ? `<button type="button" class="danger" data-act="delete">${esc(opt.danger)}</button>` : ''}
      <span class="sp"></span>
      <button type="button" data-act="cancel">キャンセル</button>
      <button type="button" class="primary" data-act="save">保存する</button>
    </menu></form>`;
  document.body.appendChild(d);
  d.addEventListener('close', () => d.remove());
  d.showModal();
  return d;
}

const val = (d: HTMLElement, name: string) =>
  d.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`)!.value.trim();
const checked = (d: HTMLElement, name: string) =>
  d.querySelector<HTMLInputElement>(`[name="${name}"]`)!.checked;

function wire(d: HTMLDialogElement, save: () => string | null, remove?: () => void) {
  const err = d.querySelector<HTMLElement>('[data-err]')!;
  const show = (m: string) => { err.textContent = m; err.hidden = false; };
  d.querySelector('[data-act=cancel]')!.addEventListener('click', () => d.close());
  d.querySelector('[data-act=save]')!.addEventListener('click', () => {
    const msg = save();
    if (msg) show(msg); else d.close();
  });
  d.querySelector('[data-act=delete]')?.addEventListener('click', () => {
    if (confirm('この記録を削除します。元に戻せません。よろしいですか？')) { remove?.(); d.close(); }
  });
}

const row = (label: string, inner: string, hint = '') =>
  `<label class="fld"><span>${esc(label)}</span>${inner}${
    hint ? `<small>${esc(hint)}</small>` : ''}</label>`;

const timeInput = (name: string, v: string) =>
  `<input name="${name}" type="time" value="${esc(v)}">`;

// ---------------------------------------------------------------- 運行

export function openTripEditor(
  trip: Trip, config: Config,
  handlers: { save: (patch: TripPatch) => void; remove: () => void },
) {
  const schools = config.schools;
  const stopRow = (s: Stop, i: number) => `<tr data-stop>
    <td><select name="s-school-${i}">${opts(withCurrent(schools, s.school), s.school)}</select></td>
    <td>${timeInput(`s-arrive-${i}`, s.arriveAt)}</td>
    <td>${timeInput(`s-depart-${i}`, s.departAt)}</td>
    <td><input name="s-count-${i}" type="number" min="0" max="20" value="${s.count}"></td>
    <td><button type="button" class="mini danger" data-del="${i}">削除</button></td></tr>`;

  const d = dialog(`運行の修正　${trip.date}`, `
    <div class="grid2">
      ${row('車両', `<select name="vehicle">${opts(withCurrent(config.vehicles.map(v => v.name), trip.vehicle), trip.vehicle)}</select>`)}
      ${row('運転者', `<select name="driver">${opts(withCurrent(config.drivers, trip.driver), trip.driver)}</select>`)}
      ${row('出発地', `<select name="base">${opts(withCurrent(config.bases, trip.base), trip.base)}</select>`)}
      ${row('出発時刻', timeInput('departAt', trip.departAt))}
      ${row('到着場所', `<select name="dest">${opts(withCurrent(config.bases, trip.dest), trip.dest)}</select>`)}
      ${row('拠点到着時刻', timeInput('returnAt', trip.returnAt), '空欄のままだと運行中の扱いになります')}
      ${row('状態', `<select name="status">
        <option value="running"${trip.status === 'running' ? ' selected' : ''}>運行中</option>
        <option value="done"${trip.status === 'done' ? ' selected' : ''}>完了</option></select>`)}
      ${row('乗車人数の合計', `<input value="${trip.stops.reduce((a, s) => a + s.count, 0)}" disabled>`, '下の立ち寄りの合計です')}
    </div>
    <p class="sub">立ち寄った学校</p>
    <table class="stops"><thead><tr><th>学校</th><th>到着</th><th>乗車出発</th><th>人数</th><th></th></tr></thead>
      <tbody data-stops>${trip.stops.map(stopRow).join('')}</tbody></table>
    <button type="button" class="mini" data-add>＋ 立ち寄りを追加</button>
    <div class="grid2">
      ${row('車内目視', `<label class="chk"><input name="mokushi" type="checkbox"${trip.mokushi ? ' checked' : ''}> 実施した</label>`)}
      ${row('コドモン打刻', `<label class="chk"><input name="codomon" type="checkbox"${trip.codomon ? ' checked' : ''}> 実施した</label>`)}
    </div>
    ${row('特記', `<input name="note" value="${esc(trip.note)}" placeholder="修正の理由など">`,
      '直した理由を残しておくと、後から経緯を追えます')}`,
    { danger: 'この運行を削除' });

  const body = d.querySelector<HTMLElement>('[data-stops]')!;
  let n = trip.stops.length;
  const rebind = () => body.querySelectorAll<HTMLElement>('[data-del]').forEach(b =>
    b.onclick = () => b.closest('tr')!.remove());
  rebind();
  d.querySelector('[data-add]')!.addEventListener('click', () => {
    body.insertAdjacentHTML('beforeend', stopRow({ school: schools[0] ?? '', arriveAt: '', departAt: '', count: 0 }, n++));
    rebind();
  });

  wire(d, () => {
    const departAt = val(d, 'departAt');
    const returnAt = val(d, 'returnAt');
    if (!TIME.test(departAt)) return '出発時刻を HH:MM で入れてください。';
    if (returnAt && !TIME.test(returnAt)) return '拠点到着時刻を HH:MM で入れてください。';

    const stops: Stop[] = [];
    for (const tr of body.querySelectorAll<HTMLElement>('[data-stop]')) {
      const i = tr.querySelector<HTMLSelectElement>('select')!.name.split('-')[2]!;
      const arriveAt = val(tr, `s-arrive-${i}`);
      const departAtS = val(tr, `s-depart-${i}`);
      if (!TIME.test(arriveAt)) return '学校の到着時刻を HH:MM で入れてください。';
      if (departAtS && !TIME.test(departAtS)) return '学校の乗車出発を HH:MM で入れてください。';
      stops.push({
        school: val(tr, `s-school-${i}`), arriveAt, departAt: departAtS,
        count: Math.max(0, Math.min(20, Number(val(tr, `s-count-${i}`)) || 0)),
      });
    }
    stops.sort((a, b) => a.arriveAt.localeCompare(b.arriveAt));

    const status = val(d, 'status') as Trip['status'];
    if (status === 'done' && !returnAt) return '完了にするには拠点到着時刻が必要です。';

    handlers.save({
      vehicle: val(d, 'vehicle'), driver: val(d, 'driver'), base: val(d, 'base'),
      departAt, dest: val(d, 'dest'), returnAt, status, stops,
      mokushi: checked(d, 'mokushi'), codomon: checked(d, 'codomon'), note: val(d, 'note'),
    });
    return null;
  }, handlers.remove);
}

// ---------------------------------------------------- アルコールチェック

const METHODS = ['対面', '写真送付', '電話', 'ビデオ通話'];

export function openAlcoholEditor(
  check: AlcoholCheck | null, config: Config, defaultDate: string,
  // 追記のときも修正のときも、欠けたフィールドを作らないよう全項目を渡す
  handlers: { save: (rec: Omit<AlcoholCheck, 'id'>) => void; remove?: () => void },
) {
  const c: AlcoholCheck = check ?? {
    id: '', date: defaultDate, kind: '運転前', driver: config.drivers[0] ?? '',
    vehicle: config.vehicles[0]?.name ?? '', at: '', result: '0.00', inspection: '良',
    note: '良好', checker: config.inspectors[0] ?? '安全運転管理者', method: '対面',
  };

  const d = dialog(check ? 'アルコールチェックの修正' : 'アルコールチェックの追記', `
    <div class="grid2">
      ${row('日付', `<input name="date" type="date" value="${esc(c.date)}">`)}
      ${row('運転者', `<select name="driver">${opts(withCurrent(config.drivers, c.driver), c.driver)}</select>`)}
      ${row('車両', `<select name="vehicle">${opts(withCurrent(config.vehicles.map(v => v.name), c.vehicle), c.vehicle)}</select>`)}
      ${row('種別', `<select name="kind">
        <option value="運転前"${c.kind === '運転前' ? ' selected' : ''}>運転前</option>
        <option value="運転後"${c.kind === '運転後' ? ' selected' : ''}>運転後</option></select>`)}
      ${row('時刻', timeInput('at', c.at))}
      ${row('結果', `<input name="result" value="${esc(c.result)}">`, '検知器の表示のまま。例：0.00')}
      ${row('日常点検', `<select name="inspection">${opts(['', '良', '否'], c.inspection)}</select>`, '運転前のみ')}
      ${row('確認方法', `<select name="method">${opts(withCurrent(METHODS, c.method), c.method)}</select>`)}
      ${row('確認者', `<select name="checker">${opts(withCurrent(config.inspectors, c.checker), c.checker)}</select>`)}
      ${row('備考', `<input name="note" value="${esc(c.note)}">`)}
    </div>
    <p class="sub note">実施していない記録をここで作らないでください。この記録簿は1年間の保存義務があります。</p>`,
    check ? { danger: 'この記録を削除' } : {});

  wire(d, () => {
    const date = val(d, 'date');
    const at = val(d, 'at');
    if (!DATE.test(date)) return '日付を入れてください。';
    if (!TIME.test(at)) return '時刻を HH:MM で入れてください。';
    handlers.save({
      date, driver: val(d, 'driver'), vehicle: val(d, 'vehicle'),
      kind: val(d, 'kind') as AlcoholCheck['kind'], at, result: val(d, 'result'),
      inspection: val(d, 'inspection'), method: val(d, 'method'),
      checker: val(d, 'checker'), note: val(d, 'note'),
    });
    return null;
  }, handlers.remove);
}

// ------------------------------------------------------------------ 設定

export function openConfigEditor(config: Config, handlers: { save: (c: Config) => void }) {
  const lines = (v: string[]) => esc(v.join('\n'));
  const d = dialog('設定（マスタ）', `
    <p class="sub note">1行に1つ。ここを直すと運転手アプリの選択肢も変わります。</p>
    <div class="grid2">
      ${row('運転者', `<textarea name="drivers" rows="8">${lines(config.drivers)}</textarea>`)}
      ${row('学校', `<textarea name="schools" rows="8">${lines(config.schools)}</textarea>`)}
      ${row('拠点・到着場所', `<textarea name="bases" rows="4">${lines(config.bases)}</textarea>`)}
      ${row('確認者', `<textarea name="inspectors" rows="4">${lines(config.inspectors)}</textarea>`)}
    </div>
    <p class="sub">車両と自動車登録番号</p>
    <p class="note">登録番号が空だと、保険会社向けの輸送記録に車両の呼び名がそのまま出ます。</p>
    <table class="stops"><thead><tr><th>車両</th><th>自動車登録番号</th><th>使用</th></tr></thead>
      <tbody>${config.vehicles.map((v, i) => `<tr>
        <td><input name="v-name-${i}" value="${esc(v.name)}"></td>
        <td><input name="v-regno-${i}" value="${esc(v.regno)}" placeholder="沖縄500あ00-00"></td>
        <td><input name="v-active-${i}" type="checkbox"${v.active ? ' checked' : ''}></td>
      </tr>`).join('')}</tbody></table>`);

  const list = (name: string) => val(d, name).split('\n').map(s => s.trim()).filter(Boolean);
  wire(d, () => {
    const drivers = list('drivers'), schools = list('schools');
    if (!drivers.length) return '運転者を1人以上入れてください。';
    if (!schools.length) return '学校を1つ以上入れてください。';
    const vehicles = config.vehicles.map((_, i) => ({
      name: val(d, `v-name-${i}`), regno: val(d, `v-regno-${i}`), active: checked(d, `v-active-${i}`),
    })).filter(v => v.name);
    handlers.save({ drivers, schools, bases: list('bases'), inspectors: list('inspectors'), vehicles });
    return null;
  });
}
