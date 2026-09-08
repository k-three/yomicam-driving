import { describe, it, expect } from 'vitest';
import { buildBoard } from './status';
import type { Trip, AlcoholCheck } from './types';

const T = { stayMin: 30, tripMin: 120 };
const trip = (o: Partial<Trip>): Trip => ({
  id: 't', date: '2026-09-08', vehicle: 'パッソ', driver: '運転者H', base: '読谷村文化センター',
  departAt: '14:00', dest: '読谷村文化センター', returnAt: '', stops: [], mokushi: false,
  handover: false, note: '', status: 'running', ...o,
});
const chk = (o: Partial<AlcoholCheck>): AlcoholCheck => ({
  id: 'a', date: '2026-09-08', kind: '運転前', driver: '運転者H', vehicle: 'パッソ',
  at: '13:50', result: '0.00', inspection: '良', note: '良好', checker: '安全運転管理者', method: '対面', ...o,
});

describe('運行状況', () => {
  it('学校での滞在が長いと警告する', () => {
    const b = buildBoard([trip({ stops: [{ school: '渡慶次小学校', arriveAt: '14:10', departAt: '', count: 0 }] })],
      [chk({})], '14:50', T);
    expect(b.running[0]!.place).toContain('滞在40分');
    expect(b.running[0]!.worries[0]).toContain('乗車の記録漏れ');
    expect(b.alerts).toBe(1);
  });

  it('運行が長すぎると終了の押し忘れを疑う', () => {
    const b = buildBoard([trip({})], [chk({})], '17:00', T);
    expect(b.running[0]!.worries.join()).toContain('終了の押し忘れ');
  });

  it('運転前チェックなしで運行中なら警告する', () => {
    const b = buildBoard([trip({})], [], '14:10', T);
    expect(b.running[0]!.worries.join()).toContain('運転前アルコールチェックが未記録');
    expect(b.alcohol[0]!.state).toBe('⚠ 運転前が未記録');
  });

  it('順調なら警告を出さない', () => {
    const b = buildBoard([trip({ stops: [{ school: '渡慶次小学校', arriveAt: '14:10', departAt: '14:20', count: 2 }] })],
      [chk({})], '14:25', T);
    expect(b.running[0]!.worries).toEqual([]);
    expect(b.alerts).toBe(0);
    expect(b.running[0]!.onboard).toBe(2);
  });

  it('取り消された記録は現況に残らない（記録から毎回組み立てるため）', () => {
    const b = buildBoard([], [chk({})], '14:25', T);
    expect(b.running).toEqual([]);
    expect(b.events).toEqual([]);
    expect(b.alcohol[0]!.state).toBe('運転前のみ記録（まだ運行なし）');
  });

  it('動きは新しい順に並ぶ', () => {
    const b = buildBoard([trip({ status: 'done', returnAt: '14:40',
      stops: [{ school: '渡慶次小学校', arriveAt: '14:10', departAt: '14:20', count: 2 }] })], [chk({})], '15:00', T);
    expect(b.events.map(e => e.at)).toEqual(['14:40', '14:20', '14:10', '14:00']);
  });
});

describe('運行を消したあとのアルコールチェック', () => {
  const check = (kind: AlcoholCheck['kind'], driver: string, at: string): AlcoholCheck => ({
    id: `${kind}-${driver}-${at}`, date: '2026-09-08', kind, driver, vehicle: '車両',
    at, result: '0.00', inspection: kind === '運転前' ? '良' : '', note: '良好',
    checker: '安全運転管理者', method: '対面',
  });

  it('運行が1件も無いのに運転前・運転後がそろっていたら知らせる', () => {
    // 運行を削除したあと、チェックだけが残っている状態。
    // アルコールの記録は独立した法定記録なので自動では消さず、ここで気づかせる
    const b = buildBoard([], [check('運転前', '運転者A', '08:00'), check('運転後', '運転者A', '17:00')],
      '18:00', { stayMin: 30, tripMin: 120 });
    const row = b.alcohol.find(a => a.driver === '運転者A')!;
    expect(row.ng).toBe(true);
    expect(row.state).toContain('運行の記録がない');
    expect(b.alerts).toBeGreaterThan(0);
  });

  it('運転前だけなら、まだ出発前なので知らせない', () => {
    const b = buildBoard([], [check('運転前', '運転者A', '08:00')],
      '08:30', { stayMin: 30, tripMin: 120 });
    expect(b.alcohol.find(a => a.driver === '運転者A')!.ng).toBe(false);
  });
});
