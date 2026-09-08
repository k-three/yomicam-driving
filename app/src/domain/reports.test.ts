import { describe, it, expect } from 'vitest';
import { buildInsuranceReport, buildAlcoholReport, buildTripReport, BRACKETS } from './reports';
import { buildReview } from './review';
import { TRIPS, CHECKS, CONFIG } from './fixtures';

const YM = '2026-09';

describe('輸送記録（保険会社提出）', () => {
  const r = buildInsuranceReport(TRIPS, CONFIG, YM);

  it('Apps Script 版と同じ区間に分割する', () => {
    // 1運行だけを対象にする。同じ日に別の運行があると区間が混ざるため
    const one = buildInsuranceReport([TRIPS[1]!], CONFIG, YM);
    expect(one.segments.map(s => [s.users, s.from, s.to, s.startAt, s.endAt, s.duration, s.note])).toEqual([
      ['待機',   'その他',      '渡慶次小学校',       '11:59', '12:00', '0時間1分',  ''],
      ['待機',   '渡慶次小学校', '渡慶次小学校',       '12:00', '12:10', '0時間10分', '学校で待機'],
      ['児童1名', '渡慶次小学校', '読谷村文化センター', '12:10', '12:02', '0時間0分',  ''],
    ]);
  });

  it('登録番号が空なら車両名で代用する（未入力は要確認で警告する）', () => {
    expect(r.segments[0]!.regno).toBe('パッソ');
  });

  it('運転者単位の1日通算と保険料区分を出す', () => {
    expect(r.daily).toEqual([
      { date: '2026-09-01', driver: '運転者H',  total: '0時間0分', bracket: BRACKETS[0] },
      { date: '2026-09-07', driver: '運転者H',  total: '0時間0分', bracket: BRACKETS[0] },
      { date: '2026-09-07', driver: '運転者K',  total: '0時間3分', bracket: BRACKETS[0] },
      { date: '2026-09-08', driver: '運転者H',  total: '0時間1分', bracket: BRACKETS[0] },
    ]);
    expect(r.counts[0]).toBe(4);
  });
});

describe('アルコール記録簿', () => {
  const rows = buildAlcoholReport(CHECKS, YM);

  it('運転者・1日=1行にまとめる', () => {
    expect(rows).toHaveLength(5);
  });

  it('0 と記録された値も 0.00 として出す（法定帳簿の体裁）', () => {
    expect(rows.every(r => r.preResult === '0.00' || r.preResult === '')).toBe(true);
  });

  it('最初の運転前と最後の運転後を採る', () => {
    const r = rows.find(x => x.date === '2026-09-08')!;
    expect([r.preAt, r.postAt]).toEqual(['10:53', '10:56']);
  });
});

describe('要確認', () => {
  const f = buildReview(TRIPS, CHECKS, CONFIG, YM);
  const has = (s: string) => f.some(x => x.what.includes(s));

  it('本番で見つかった不整合をすべて拾う', () => {
    expect(has('乗車出発（12:10）が拠点到着（12:02）より後')).toBe(true);
    expect(has('到着時刻が出発時刻以前（10:13 → 10:13）')).toBe(true);
    expect(has('運転前チェック（10:53）がこの日の最初の出発（10:13）より後')).toBe(true);
    expect(has('アルコール記録が2行重複')).toBe(true);
    expect(has('自動車登録番号が未入力')).toBe(true);
    expect(has('運行記録がないのにアルコールチェックだけある')).toBe(true);
    expect(has('拠点到着が押されないまま自動転記された運行')).toBe(true);
  });

  it('未完了の運行では派生する指摘を出さない（同じ原因で埋めない）', () => {
    const inc = f.filter(x => x.tripId === '20260901-パッソ-1727');
    expect(inc.some(x => x.what.includes('到着時刻が空欄'))).toBe(false);
    expect(inc.some(x => x.what.includes('乗車出発が空欄'))).toBe(false);
  });

  it('正常な運行には指摘を出さない', () => {
    const clean = buildReview(
      [{ ...TRIPS[1]!, id: 'ok', returnAt: '12:40',
         stops: [{ school: '渡慶次小学校', arriveAt: '12:05', departAt: '12:15', count: 2 }] }],
      [{ ...CHECKS[1]!, at: '11:50' }, { ...CHECKS[2]!, at: '12:45' }],
      { ...CONFIG, vehicles: [{ name: 'フリード1', regno: '沖縄400あ12-34', active: true }] }, YM);
    expect(clean).toEqual([]);
  });
});

describe('運行日報', () => {
  it('確定済みだけを時系列で並べる', () => {
    const rows = buildTripReport(TRIPS, YM);
    expect(rows.map(t => t.id)).toEqual([
      '20260901-パッソ-1727', '20260907-フリード1-1159', '20260907-フリード1-1219',
      '20260907-パッソ-1543', '20260908-パッソ-1013', '20260908-パッソ-1053',
    ]);
  });
});
