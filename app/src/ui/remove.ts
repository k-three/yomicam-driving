/** 運行の削除。運転手アプリと管理画面で同じ手順を踏むために、ここにまとめる。
 *
 *  アルコールチェックは運行に紐づかない独立した法定記録なので、運行を消しても
 *  自動では消さない（1日に何回運行してもチェックは1組であり、運転しなかった日でも
 *  実施したなら記録は残る）。ただし、その運転者の本日の運行が1件も無くなる場合は
 *  試し入力の可能性が高いので、まとめて消すかどうかを尋ねる。 */
import type { Trip } from '../domain/types';
import type { Snapshot, Store } from '../store/store';

export async function removeTripAndAsk(store: Store, snap: Snapshot, t: Trip) {
  const others = snap.trips.filter(x => x.id !== t.id && x.driver === t.driver);
  const checks = snap.checks.filter(c => c.driver === t.driver);

  await store.cancelTrip(t.id);

  if (others.length || !checks.length) return;
  const ok = confirm(
    `${t.driver} さんの本日の運行は、これで1件も無くなります。\n`
    + `アルコールチェックの記録が ${checks.length}件 残ります。\n\n`
    + `これも削除しますか？\n\n`
    + `・試し入力だった → OK（削除する）\n`
    + `・実際に確認を行った → キャンセル（記録簿に残す）`);
  if (!ok) return;
  for (const c of checks) await store.deleteAlcohol(c.id);
}
