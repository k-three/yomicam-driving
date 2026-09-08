/** Apps Script 版と同じ集計結果になることを確かめるための基準データ（2026年9月）。
 *
 *  日付・時刻・学校・人数・記録の欠け方は、移行前に実際に起きていたものをそのまま
 *  写している（時刻の逆転、未完了の自動転記、アルコール記録の重複など）。
 *  運転者名と車両名だけは仮の名前に置き換えてある。検証しているのは集計であって
 *  氏名ではないため、これで検証力は落ちない。 */
import type { Trip, AlcoholCheck, Config } from './types';

const trip = (o: Partial<Trip> & Pick<Trip, 'id' | 'date' | 'vehicle' | 'driver'>): Trip => ({
  base: '読谷村文化センター', departAt: '', dest: '読谷村文化センター', returnAt: '',
  stops: [], mokushi: false, codomon: false, note: '', status: 'done', ...o,
});

const INCOMPLETE = '⚠未完了：拠点到着が記録されないまま日付が変わったため自動転記。到着時刻・乗車人数を確認してください';

export const TRIPS: Trip[] = [
  trip({ id: '20260901-パッソ-1727', date: '2026-09-01', vehicle: 'パッソ', driver: '運転者H',
    departAt: '17:27', dest: '（未記録）', returnAt: '', note: INCOMPLETE,
    stops: [{ school: '渡慶次小学校', arriveAt: '17:27', departAt: '', count: 0 }] }),
  trip({ id: '20260907-フリード1-1159', date: '2026-09-07', vehicle: 'フリード1', driver: '運転者K',
    base: 'その他', departAt: '11:59', returnAt: '12:02', mokushi: true, codomon: true,
    stops: [{ school: '渡慶次小学校', arriveAt: '12:00', departAt: '12:10', count: 1 }] }),
  trip({ id: '20260907-フリード1-1219', date: '2026-09-07', vehicle: 'フリード1', driver: '運転者K',
    departAt: '12:19', dest: '（未記録）', returnAt: '', note: INCOMPLETE,
    stops: [{ school: '古堅小学校', arriveAt: '12:20', departAt: '', count: 0 }] }),
  trip({ id: '20260907-パッソ-1543', date: '2026-09-07', vehicle: 'パッソ', driver: '運転者H',
    departAt: '15:43', dest: '（未記録）', returnAt: '', note: INCOMPLETE,
    stops: [{ school: '渡慶次小学校', arriveAt: '15:44', departAt: '', count: 0 }] }),
  trip({ id: '20260908-パッソ-1013', date: '2026-09-08', vehicle: 'パッソ', driver: '運転者H',
    departAt: '10:13', returnAt: '10:13', mokushi: true, codomon: true,
    stops: [{ school: '読谷小学校', arriveAt: '10:13', departAt: '10:13', count: 1 }] }),
  trip({ id: '20260908-パッソ-1053', date: '2026-09-08', vehicle: 'パッソ', driver: '運転者H',
    departAt: '10:53', returnAt: '10:54', mokushi: true, codomon: true,
    stops: [{ school: '古堅小学校', arriveAt: '10:53', departAt: '10:54', count: 1 },
            { school: '喜名小学校', arriveAt: '10:54', departAt: '10:54', count: 2 }] }),
];

const chk = (date: string, kind: '運転前' | '運転後', driver: string, vehicle: string, at: string): AlcoholCheck =>
  ({ id: `${date}-${kind}-${driver}-${at}`, date, kind, driver, vehicle, at,
     result: '0', inspection: kind === '運転前' ? '良' : '', note: '良好',
     checker: '安全運転管理者', method: '対面' });

export const CHECKS: AlcoholCheck[] = [
  chk('2026-09-01', '運転前', '運転者H', 'パッソ', '17:27'),
  chk('2026-09-07', '運転前', '運転者K', 'フリード1', '11:58'),
  chk('2026-09-07', '運転後', '運転者K', 'フリード1', '11:59'),
  chk('2026-09-07', '運転前', '運転者J', 'フリード2', '13:32'),
  chk('2026-09-07', '運転後', '運転者J', 'フリード2', '13:33'),
  chk('2026-09-07', '運転後', '運転者J', 'フリード2', '13:33'),   // 重複
  chk('2026-09-07', '運転前', '運転者H', 'パッソ', '15:43'),
  chk('2026-09-07', '運転前', '運転者H', 'パッソ', '15:43'),   // 重複
  chk('2026-09-08', '運転前', '運転者H', 'パッソ', '10:53'),
  chk('2026-09-08', '運転後', '運転者H', 'パッソ', '10:56'),
];

export const CONFIG: Config = {
  drivers: ['運転者A', '運転者B', '運転者C', '運転者D', '運転者E', '運転者F',
            '運転者G', '運転者H', '運転者I', '運転者J', '運転者K'],
  vehicles: ['ハイエース', 'パッソ', 'フィット', 'ハスラー',
             'フリード1', 'フリード2', 'タント'].map(name => ({ name, regno: '', active: true })),
  bases: ['読谷村文化センター', '自宅', 'その他'],
  inspectors: ['安全運転管理者'],
  schools: ['読谷小学校', '渡慶次小学校', '喜名小学校', '古堅小学校', '古堅南小学校', 'よみたん自然学校'],
};
