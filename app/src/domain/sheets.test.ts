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

describe('児童の氏名', () => {
  const kids = [
    { name: '山田そら', alias: 'そら', school: '渡慶次小学校', grade: '1年', active: true },
    { name: '田中りおん', alias: 'りおん', school: '渡慶次小学校', grade: '3年', active: true },
  ];
  const withRiders = {
    trips: [{
      id: 'x', date: '2026-09-10', vehicle: '車両', driver: '運転者', base: '拠点',
      departAt: '14:00', dest: '拠点', returnAt: '15:00', status: 'done' as const,
      mokushi: true, handover: true, note: '',
      stops: [{ school: '渡慶次小学校', arriveAt: '14:20', departAt: '14:30', count: 2,
                riders: [{ name: '山田そら', alias: 'そら' },
                         { name: '田中りおん', alias: 'りおん' }] }],
    }],
    checks: [], config: { ...CONFIG, children: kids }, ym: '2026-09',
  };

  it('保険会社向けの利用者欄に、正式な氏名が入る', () => {
    const rows = reportSheets('insurance', withRiders)[0]!.rows;
    // 学校まで空車 → 学校で待機 → 児童を乗せて拠点へ
    expect(String(rows[0]![2])).toBe('待機');
    expect(String(rows[1]![2])).toBe('待機');
    expect(String(rows[2]![2])).toBe('山田そら、田中りおん');
  });

  it('氏名を登録する前の記録は、これまでどおり人数で出る', () => {
    const rows = reportSheets('insurance', src)[0]!.rows;
    expect(rows.some(r => String(r[2]).includes('児童'))).toBe(true);
  });

  it('運行日報には正式な氏名、経由の欄は呼び名', () => {
    const [head, ...rest] = [reportSheets('trips', withRiders)[0]!.head,
                             ...reportSheets('trips', withRiders)[0]!.rows];
    const i = head.indexOf('児童'), j = head.indexOf('経由');
    expect(String(rest[0]![i])).toBe('山田そら、田中りおん');
    expect(String(rest[0]![j])).toContain('そら・りおん');
  });
});
