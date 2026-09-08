/** 印刷用の表示。ブラウザの印刷から「PDFに保存」でそのまま提出できる体裁にする。
 *  PDF ライブラリを使わないのは、日本語フォントの埋め込みで数MBになるうえ、
 *  ブラウザの印刷のほうが改ページと見出しの繰り返しをきれいに扱えるため。 */
import type { SheetSpec } from '../export/xlsx';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

function sheetHtml(sp: SheetSpec, footer: string): string {
  return `<section class="sheet ${sp.landscape === false ? 'port' : 'land'}">
    ${sp.title ? `<h1>${esc(sp.title)}</h1>` : ''}
    <table>
      <thead><tr>${sp.head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${sp.rows.length
        ? sp.rows.map(r => `<tr>${sp.head.map((_, i) =>
            `<td>${esc(r[i] ?? '')}</td>`).join('')}</tr>`).join('')
        : `<tr><td colspan="${sp.head.length}" class="empty">該当する記録がありません</td></tr>`}</tbody>
    </table>
    <p class="foot">${esc(footer)}</p>
  </section>`;
}

/** 表を印刷用の領域に描いて、ブラウザの印刷を開く */
export function printSheets(sheets: SheetSpec[], footer: string) {
  let area = document.getElementById('printable');
  if (!area) {
    area = document.createElement('div');
    area.id = 'printable';
    document.body.appendChild(area);
  }
  area.innerHTML = sheets.map(sp => sheetHtml(sp, footer)).join('');
  window.print();
}
