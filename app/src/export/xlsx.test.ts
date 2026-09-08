/** 自前の xlsx 書き出し。壊れたファイルを渡してしまうのがいちばん困るので、
 *  zip として開けること・XML のタグが閉じていること・値が入っていることを見る。
 *  （Excel で開けるかどうかは Node 側で openpyxl でも確認済み） */
import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { xlsxBytes, xlsxParts, type SheetSpec } from './xlsx';

const sheets: SheetSpec[] = [
  { name: '輸送記録', title: '2026年9月　輸送記録',
    head: ['運転者', '所要時間', '人数'],
    rows: [['運転者J', '0時間23分', 3], ['運転者K <&">', '0時間11分', 0]] },
  { name: '記録簿', landscape: false, head: ['日付'], rows: [] },
];

describe('xlsx の書き出し', () => {
  const files = unzipSync(xlsxBytes(sheets));
  const text = (p: string) => strFromU8(files[p]!);

  it('必要な部品がそろっている', () => {
    for (const p of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml',
                     'xl/_rels/workbook.xml.rels', 'xl/styles.xml',
                     'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml'])
      expect(Object.keys(files)).toContain(p);
  });

  it('値と表題が入っている', () => {
    const s1 = text('xl/worksheets/sheet1.xml');
    expect(s1).toContain('2026年9月　輸送記録');
    expect(s1).toContain('運転者J');
    expect(s1).toContain('<v>3</v>');            // 数値は数値として入る
  });

  it('XML として危ない文字を逃がしている', () => {
    const s1 = text('xl/worksheets/sheet1.xml');
    expect(s1).toContain('運転者K &lt;&amp;&quot;&gt;');
    expect(s1).not.toContain('運転者K <&">');
  });

  it('印刷の向きと、見出し行の繰り返しを指定している', () => {
    expect(text('xl/worksheets/sheet1.xml')).toContain('orientation="landscape"');
    expect(text('xl/worksheets/sheet2.xml')).toContain('orientation="portrait"');
    // 表題がある側は3行目、無い側は1行目が見出し
    const wb = text('xl/workbook.xml');
    expect(wb).toContain(`'輸送記録'!$3:$3`);
    expect(wb).toContain(`'記録簿'!$1:$1`);
  });

  it('タグの開きと閉じが釣り合っている', () => {
    for (const xml of Object.values(xlsxParts(sheets))) {
      const open = (xml.match(/<[a-zA-Z]/g) ?? []).length;
      const close = (xml.match(/<\//g) ?? []).length + (xml.match(/\/>/g) ?? []).length;
      expect(open).toBe(close);
    }
  });

  it('行が無くても開ける形になる', () => {
    expect(text('xl/worksheets/sheet2.xml')).toContain('<sheetData>');
  });
});
