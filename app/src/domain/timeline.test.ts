import { describe, it, expect } from 'vitest';
import { tripSpans, timeWindow } from './timeline';
import type { Trip } from './types';

const trip = (o: Partial<Trip>): Trip => ({
  id: 't', date: '2026-09-08', vehicle: 'パッソ', driver: '運転者H', base: '読谷村文化センター',
  departAt: '14:00', dest: '読谷村文化センター', returnAt: '', stops: [], mokushi: false,
  codomon: false, note: '', status: 'running', ...o,
});

describe('時系列の帯', () => {
  it('出発直後は拠点からの回送1本', () => {
    const s = tripSpans(trip({}), '14:12');
    expect(s.map(x => [x.kind, x.from, x.to, x.live])).toEqual([['ferry', '14:00', '14:12', true]]);
  });

  it('学校に滞在中はそこで止まり、先の区間を作らない', () => {
    const s = tripSpans(trip({ stops: [{ school: '渡慶次小学校', arriveAt: '14:10', departAt: '', count: 0 }] }), '14:25');
    expect(s.map(x => [x.kind, x.from, x.to, x.live])).toEqual([
      ['ferry', '14:00', '14:10', false],
      ['wait', '14:10', '14:25', true],
    ]);
  });

  it('乗せたあとは「児童を乗せて移動」になる', () => {
    const s = tripSpans(trip({
      stops: [{ school: '渡慶次小学校', arriveAt: '14:10', departAt: '14:20', count: 2 },
              { school: '古堅小学校', arriveAt: '14:30', departAt: '14:36', count: 1 }],
    }), '14:45');
    expect(s.map(x => x.kind)).toEqual(['ferry', 'wait', 'onboard', 'wait', 'onboard']);
    expect(s[2]!.detail).toContain('児童2名');
    expect(s[4]!.detail).toContain('児童3名');
  });

  it('確定した運行は到着で閉じる', () => {
    const s = tripSpans(trip({ status: 'done', returnAt: '14:50',
      stops: [{ school: '渡慶次小学校', arriveAt: '14:10', departAt: '14:20', count: 2 }] }), '16:00');
    expect(s[s.length - 1]!.to).toBe('14:50');
    expect(s.every(x => !x.live)).toBe(true);
  });
});

describe('表示する時間帯', () => {
  it('運行と現在時刻の両方が入る', () => {
    const w = timeWindow([trip({ departAt: '13:00', returnAt: '13:40', status: 'done' })], '15:00');
    expect(w.start).toBeLessThanOrEqual(13 * 60);
    expect(w.end).toBeGreaterThanOrEqual(15 * 60);
  });
  it('運行がなくても幅を持つ', () => {
    const w = timeWindow([], '10:00');
    expect(w.end - w.start).toBeGreaterThanOrEqual(60);
  });
});
