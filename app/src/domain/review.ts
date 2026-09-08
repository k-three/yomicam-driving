/** 提出前の「要確認」抽出。誤入力・記録漏れの疑いを洗い出す。
 *  Apps Script 版で実データから見つけた見落とし（時刻の逆転、アルコールの重複、
 *  運転前チェックが出発より後、車両ナンバー未入力）もすべて含む。 */
import type { Trip, AlcoholCheck, Config, Finding, FixTarget, Day } from './types';
import { elapsed, hm, isAfter, normResult, toMin } from './time';
import { totalCount } from './reports';

export const THRESHOLD = {
  minTripMin: 5,     // これ未満は誤タップの疑い
  maxTripMin: 240,   // これ超は終了の押し忘れの疑い
  maxStayMin: 60,    // 学校での待機がこれ超は押し忘れの疑い
};

const inMonth = (d: Day, ym: string) => d.slice(0, 7) === ym;

export function buildReview(
  trips: Trip[], checks: AlcoholCheck[], config: Config, ym: string,
): Finding[] {
  const out: Finding[] = [];
  const add = (severity: Finding['severity'], tripId: string, date: Day,
               subject: string, what: string, how: string,
               fix: FixTarget = tripId ? { kind: 'trip', id: tripId } : { kind: 'config' }) =>
    out.push({ severity, tripId, fix, date, subject, what, how });

  const target = trips.filter(t => t.status === 'done' && inMonth(t.date, ym));
  const alc = checks.filter(c => inMonth(c.date, ym));

  // 運転者・日ごとのアルコール記録の有無と、最初の運転前の時刻
  type Seen = { pre: boolean; post: boolean; preAt: string };
  const seen = new Map<string, Seen>();
  const dup = new Map<string, string[]>();
  for (const c of alc) {
    const key = `${c.date}|${c.driver}`;
    const s = seen.get(key) ?? { pre: false, post: false, preAt: '' };
    if (c.kind === '運転前') {
      s.pre = true;
      if (!s.preAt || isAfter(s.preAt, c.at)) s.preAt = c.at;   // 最も早い運転前
    } else s.post = true;
    seen.set(key, s);
    const dk = `${c.date}|${c.kind}|${c.driver}|${c.at}`;
    dup.set(dk, [...(dup.get(dk) ?? []), c.id]);
  }

  // 運転者・日ごとの最初の出発時刻
  const firstDep = new Map<string, string>();
  for (const t of target) {
    const key = `${t.date}|${t.driver}`;
    const cur = firstDep.get(key);
    if (!cur || isAfter(cur, t.departAt)) firstDep.set(key, t.departAt);
  }

  const reported = new Set<string>();

  for (const t of target) {
    const who = `${t.vehicle}／${t.driver}`;
    // 未完了として自動転記された運行は、到着や人数が欠けて当然なので派生指摘は出さない
    const incomplete = t.note.includes('未完了');
    if (incomplete)
      add('要確認', t.id, t.date, who, '拠点到着が押されないまま自動転記された運行',
          '到着時刻と乗車人数を入れる。運行していなければ削除');

    if (!t.returnAt) {
      if (!incomplete) add('要確認', t.id, t.date, who, '到着時刻が空欄', '実際の到着時刻を入れるか、削除');
    } else {
      const mins = elapsed(t.departAt, t.returnAt);
      if (mins === 0)
        add('要確認', t.id, t.date, who, `到着時刻が出発時刻以前（${t.departAt} → ${t.returnAt}）`, '時刻を修正するか、削除');
      else if (mins < THRESHOLD.minTripMin)
        add('確認推奨', t.id, t.date, who, `運行時間が${mins}分と極端に短い`, '誤タップの可能性。運行していなければ削除');
      else if (mins > THRESHOLD.maxTripMin)
        add('確認推奨', t.id, t.date, who, `運行時間が${hm(mins)}と極端に長い`, '終了の押し忘れの可能性。到着時刻を修正');
    }

    if (!incomplete) {
      if (!t.stops.length)
        add('確認推奨', t.id, t.date, who, '立ち寄った学校の記録がない', '誤って開始・終了した可能性。不要なら削除');
      else if (totalCount(t) === 0)
        add('確認推奨', t.id, t.date, who, '乗車人数が0人', '人数の入れ忘れの可能性。実績を確認');
      if (!t.mokushi)
        add('確認推奨', t.id, t.date, who, '車内目視が未実施のまま', '置き去り防止の確認。実施していれば修正');
    }

    for (const s of t.stops) {
      if (isAfter(t.departAt, s.arriveAt))
        add('要確認', t.id, t.date, who,
            `${s.school}の学校到着（${s.arriveAt}）が出発時刻（${t.departAt}）より前`, '時刻が前後しています。修正してください');
      if (s.departAt && t.returnAt && isAfter(s.departAt, t.returnAt))
        add('要確認', t.id, t.date, who,
            `${s.school}の乗車出発（${s.departAt}）が拠点到着（${t.returnAt}）より後`, '時刻が前後しています。修正してください');
      if (!s.departAt) {
        if (!incomplete) add('要確認', t.id, t.date, who, `${s.school}の乗車出発が空欄`, '時刻を入れるか、該当の立ち寄りを削除');
      } else {
        const stay = elapsed(s.arriveAt, s.departAt);
        if (stay > THRESHOLD.maxStayMin)
          add('確認推奨', t.id, t.date, who, `${s.school}での待機が${hm(stay)}`, '押し忘れの可能性。時刻を確認');
      }
    }

    // アルコールの指摘は運転者・日ごとに1回だけ
    const akey = `${t.date}|${t.driver}`;
    if (!reported.has(akey)) {
      reported.add(akey);
      const s = seen.get(akey) ?? { pre: false, post: false, preAt: '' };
      if (!s.pre) add('要確認', t.id, t.date, who, 'この日の運転前アルコールチェックが未記録', '法定記録。実施していれば追記');
      if (!s.post) add('要確認', t.id, t.date, who, 'この日の運転後アルコールチェックが未記録', '法定記録。実施していれば追記');
      const dep = firstDep.get(akey);
      if (s.preAt && dep && isAfter(s.preAt, dep))
        add('要確認', t.id, t.date, who,
            `運転前チェック（${s.preAt}）がこの日の最初の出発（${dep}）より後`,
            '運行後に記録された可能性。実際の実施時刻に直すか、経緯を特記に残す');
    }
  }

  // 同じ内容の重複（二度押しや再送信で起きる）
  for (const [k, ids] of dup) {
    if (ids.length < 2) continue;
    const [date, kind, driver, at] = k.split('|') as [Day, string, string, string];
    add('要確認', '', date, driver, `アルコール記録が${ids.length}行重複（${kind} ${at}）`,
        '1行だけ残して削除', { kind: 'alcohol', id: ids[ids.length - 1]! });
  }

  // 運行がないのにアルコール記録だけある
  const drove = new Set(target.map(t => `${t.date}|${t.driver}`));
  for (const key of seen.keys()) {
    if (drove.has(key)) continue;
    const [date, driver] = key.split('|') as [Day, string];
    const first = alc.find(c => `${c.date}|${c.driver}` === key)!;
    add('確認推奨', '', date, driver, '運行記録がないのにアルコールチェックだけある',
        'テスト入力の可能性。不要なら削除', { kind: 'alcohol', id: first.id });
  }

  // 使用した車両の登録番号が空だと、輸送記録に車両の呼称がそのまま出る
  const regnoOf = new Map(config.vehicles.map(v => [v.name, v.regno]));
  for (const v of new Set(target.map(t => t.vehicle))) {
    if (!regnoOf.get(v)) add('要確認', '', '', v, '自動車登録番号が未入力', '設定でナンバーを入力。空欄だと輸送記録に車両名が出ます');
  }

  return out.sort((a, b) => (a.date + a.tripId < b.date + b.tripId ? -1 : 1));
}
