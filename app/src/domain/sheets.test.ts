/** 帳票の表の形。実データ（fixtures）で列と行が崩れていないことを確かめる。
 *  ここが崩れると提出物が崩れるので、集計の検証（reports.test.ts）とは別に見る。 */
import { describe, expect, it } from 'vitest';
import { CHECKS, CONFIG, TRIPS } from './fixtures';
import { REPORT, reportFilename, reportSheets, type ReportKind } from './sheets';
import { buildInsuranceReport } from './reports';

const src = { trips: TRIPS, checks: CHECKS, config: CONFIG, ym: '2026-09' };
const KINDS: ReportKind[] = ['insurance', 'alcohol', 'trips', 'review'];

describe('帳票の表', () => {
  it('どの帳票も、行の列数が見出しと一致する', () => {
    for (const k of KINDS)
      for (const sp of reportSheets(k, src))
        for (const row of sp.rows)
          expect(row.length, `${k} / ${sp.name}`).toBe(sp.head.length);
  });

  it('シート名と表題が入っている', () => {
    for (const k of KINDS)
      for (const sp of reportSheets(k, src)) {
        expect(sp.name).not.toBe('');
        expect(sp.title).toContain('2026年9月');
      }
  });

  it('輸送記録は区間の集計と同じ行数になる', () => {
    const r = buildInsuranceReport(TRIPS, CONFIG, '2026-09');
    const sheets = reportSheets('insurance', src);
    expect(sheets[0]!.rows).toHaveLength(r.segments.length);
    expect(sheets[1]!.rows).toHaveLength(10);   // 保険料の時間区分は10段階
    expect(sheets[2]!.rows).toHaveLength(r.daily.length);
  });

  it('アルコール記録簿は縦向き、輸送記録は横向き', () => {
    expect(reportSheets('alcohol', src)[0]!.landscape).toBe(false);
    expect(reportSheets('insurance', src)[0]!.landscape).not.toBe(false);
  });

  it('ファイル名は半角英数（日本語だとブラウザによって落ちるため）', () => {
    for (const k of KINDS) {
      const name = reportFilename(k, '2026-09');
      expect(name).toMatch(/^[A-Za-z0-9_]+_\d{6}\.xlsx$/);
      expect(REPORT[k].label).not.toBe('');
    }
  });

  it('要確認は「どこを直すか」を持つ', () => {
    const rows = reportSheets('review', src)[0]!.rows;
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(String(r[0])).toMatch(/要確認|確認推奨/);
  });
});
