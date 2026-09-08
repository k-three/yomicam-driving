/** Excel（.xlsx）の書き出し。
 *
 *  外部ライブラリを使わず自前で組んでいるのは、
 *  (1) 列幅・太字・印刷設定（A4・向き・横1ページに収める・見出し行の繰り返し）まで
 *      指定したいが、無料で使える出力ライブラリはここまで面倒を見ないこと、
 *  (2) 提出物の体裁を握るコードは小さく手元に置いたほうが直しやすいこと、による。
 *  必要なのは zip 圧縮だけなので fflate を使う。
 */
import { zipSync, strToU8 } from 'fflate';

export type Cell = string | number;

export type SheetSpec = {
  name: string;
  title?: string;        // 1行目に置く表題
  head: string[];
  rows: Cell[][];
  widths?: number[];     // 文字数。省略時は見出しと中身から見積もる
  /** 既定は横向き。縦向きにしたいときだけ false */
  landscape?: boolean;
};

/** XML に入れられない制御文字を落とす（タブ・改行は残す） */
function strip(s: string): string {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) continue;
    out += ch;
  }
  return out;
}

const esc = (s: string) => strip(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 全角を2文字ぶんとして数えた表示幅。日本語の列幅を見積もるため */
function width(s: string): number {
  let n = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    n += c < 0x100 || (c >= 0xff61 && c <= 0xff9f) ? 1 : 2;   // 半角カナも1
  }
  return n;
}

const colName = (i: number): string => {
  let s = '';
  for (let n = i; n >= 0; n = Math.floor(n / 26) - 1) s = String.fromCharCode(65 + (n % 26)) + s;
  return s;
};

/** styles.xml の cellXfs の並びと対応。0=標準 1=表題 2=見出し 3=本文 */
const S = { title: 1, head: 2, body: 3 } as const;

function cellXml(ref: string, v: Cell, style: number): string {
  return typeof v === 'number' && Number.isFinite(v)
    ? `<c r="${ref}" s="${style}"><v>${v}</v></c>`
    : `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`;
}

function sheetXml(sp: SheetSpec): string {
  const cols = sp.widths ?? sp.head.map((h, i) => {
    const body = sp.rows.reduce((m, r) => Math.max(m, width(String(r[i] ?? ''))), 0);
    return Math.min(48, Math.max(8, Math.max(width(h), body) * 0.75 + 2.5));
  });
  const colsXml = cols.map((w, i) =>
    `<col min="${i + 1}" max="${i + 1}" width="${w.toFixed(1)}" customWidth="1"/>`).join('');

  const lines: string[] = [];
  let r = 1;
  if (sp.title) {
    lines.push(`<row r="${r}" ht="21" customHeight="1">${cellXml(`A${r}`, sp.title, S.title)}</row>`);
    r += 2;   // 表題の下を1行あける
  }
  const headRow = r;
  lines.push(`<row r="${r}" ht="20" customHeight="1">${
    sp.head.map((h, i) => cellXml(`${colName(i)}${r}`, h, S.head)).join('')}</row>`);
  r++;
  for (const row of sp.rows) {
    lines.push(`<row r="${r}">${
      row.map((v, i) => cellXml(`${colName(i)}${r}`, v, S.body)).join('')}</row>`);
    r++;
  }

  const last = `${colName(sp.head.length - 1)}${Math.max(r - 1, headRow)}`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
<dimension ref="A1:${last}"/>
<sheetViews><sheetView workbookViewId="0">
<pane ySplit="${headRow}" topLeftCell="A${headRow + 1}" activePane="bottomLeft" state="frozen"/>
</sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="18"/>
<cols>${colsXml}</cols>
<sheetData>${lines.join('')}</sheetData>
<printOptions horizontalCentered="1"/>
<pageMargins left="0.35" right="0.35" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>
<pageSetup paperSize="9" orientation="${sp.landscape === false ? 'portrait' : 'landscape'}" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="4">
<font><sz val="10"/><name val="Yu Gothic"/></font>
<font><b/><sz val="14"/><name val="Yu Gothic"/></font>
<font><b/><sz val="10"/><name val="Yu Gothic"/></font>
<font><sz val="10"/><name val="Yu Gothic"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFEAE8E0"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border>
<left style="thin"><color rgb="FFBFBFBF"/></left><right style="thin"><color rgb="FFBFBFBF"/></right>
<top style="thin"><color rgb="FFBFBFBF"/></top><bottom style="thin"><color rgb="FFBFBFBF"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/** 各シートの見出し行を、印刷時に全ページの先頭で繰り返す */
const printTitles = (sheets: SheetSpec[]) => sheets.map((sp, i) => {
  const row = sp.title ? 3 : 1;
  return `<definedName name="_xlnm.Print_Titles" localSheetId="${i}">'${esc(sp.name)}'!$${row}:$${row}</definedName>`;
}).join('');

export function xlsxParts(sheets: SheetSpec[]): Record<string, string> {
  return {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('\n')}
</Types>`,

    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,

    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${sheets.map((s, i) =>
  `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>
<definedNames>${printTitles(sheets)}</definedNames>
</workbook>`,

    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('\n')}
<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,

    'xl/styles.xml': STYLES,
    ...Object.fromEntries(sheets.map((sp, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(sp)])),
  };
}

export function xlsxBytes(sheets: SheetSpec[]): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  for (const [path, xml] of Object.entries(xlsxParts(sheets))) files[path] = strToU8(xml);
  return zipSync(files, { level: 6 });
}

export function buildXlsx(sheets: SheetSpec[]): Blob {
  const bytes = xlsxBytes(sheets);
  return new Blob([bytes.slice().buffer as ArrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

/** 作ったファイルを保存させる */
export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  // クリックの処理が終わる前に取り除くと、ブラウザによってはファイル名が失われる
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
}
