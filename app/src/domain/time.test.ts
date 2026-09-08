import { describe, it, expect } from 'vitest';
import { toMin, elapsed, isAfter, hm, normResult, normSchool } from './time';

describe('時刻', () => {
  it('分に変換する', () => {
    expect(toMin('14:05')).toBe(845);
    expect(toMin('9:30')).toBe(570);
    expect(toMin('25:00')).toBeNull();
    expect(toMin('')).toBeNull();
  });

  it('経過分は負を 0 にする（提供時間の集計用）', () => {
    expect(elapsed('12:10', '12:02')).toBe(0);
    expect(elapsed('14:00', '14:50')).toBe(50);
  });

  it('前後関係は経過分と別に判定する（逆転を見逃さない）', () => {
    // 本番で起きた「乗車出発 12:10 が拠点到着 12:02 より後」のケース
    expect(isAfter('12:10', '12:02')).toBe(true);
    expect(isAfter('12:02', '12:10')).toBe(false);
    expect(isAfter('', '12:00')).toBe(false);
  });

  it('時間の表記', () => {
    expect(hm(90)).toBe('1時間30分');
    expect(hm(0)).toBe('0時間0分');
  });
});

describe('検知結果の表記', () => {
  it('0 も 0.00 として扱う（「検出」の誤表示を防ぐ）', () => {
    expect(normResult(0)).toBe('0.00');
    expect(normResult('0')).toBe('0.00');
    expect(normResult('0.00')).toBe('0.00');
  });
  it('数値はそのまま2桁に、文字列は保つ', () => {
    expect(normResult(0.15)).toBe('0.15');
    expect(normResult('検出')).toBe('検出');
    expect(normResult('')).toBe('');
  });
});

describe('学校名', () => {
  it('略称と正式名を同一視する', () => {
    expect(normSchool('渡慶次小')).toBe(normSchool('渡慶次小学校'));
    expect(normSchool('よみたん自然学校')).toBe('よみたん自然');
    expect(normSchool('読谷小')).not.toBe(normSchool('喜名小'));
  });
});
