/** firestore.rules の検証。
 *
 *  ルールの反映は手作業なので、間違えると「画面はあるのに動かない」状態になる。
 *  実際にこれまで2度起きているので、エミュレータ上で条件を1つずつ確かめる。
 *
 *  実行： npm run test:rules
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertFails, assertSucceeds, initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';

let env: RulesTestEnvironment;

/** 日本時間の今日・昨日を 20260909 の形で */
const ymdOf = (d: Date) => {
  const j = new Date(d.getTime() + 9 * 3600_000);
  return j.getUTCFullYear() * 10000 + (j.getUTCMonth() + 1) * 100 + j.getUTCDate();
};
const dateOf = (d: Date) => {
  const j = new Date(d.getTime() + 9 * 3600_000);
  return j.toISOString().slice(0, 10);
};
const TODAY = ymdOf(new Date());
const YESTERDAY = ymdOf(new Date(Date.now() - 86400_000));

/** パスワードでログインした人。運転手も管理者も同じ入口を通る */
const asPassword = (uid: string) =>
  env.authenticatedContext(uid, { firebase: { sign_in_provider: 'password' } } as never).firestore();
const asAnonymous = () =>
  env.authenticatedContext('anon', { firebase: { sign_in_provider: 'anonymous' } } as never).firestore();

const DRIVER = 'driver-uid', ADMIN = 'admin-uid';

const trip = (o: Record<string, unknown> = {}) => ({
  date: dateOf(new Date()), ymd: TODAY, vehicle: 'パッソ', driver: '運転者A',
  base: '拠点', departAt: '10:00', dest: '拠点', returnAt: '', stops: [],
  mokushi: false, handover: false, note: '', status: 'running', createdBy: DRIVER, ...o,
});

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-yomicam',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});
afterAll(() => env.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  // 管理者の名簿と、あらかじめ入っている記録を用意する（ルールを迂回して書く）
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'admins', ADMIN), {});
    await setDoc(doc(db, 'trips', 'today-running'), trip());
    await setDoc(doc(db, 'trips', 'today-done'), trip({ status: 'done', returnAt: '11:00' }));
    await setDoc(doc(db, 'trips', 'yesterday'), trip({
      status: 'done', returnAt: '11:00', ymd: YESTERDAY,
      date: dateOf(new Date(Date.now() - 86400_000)),
    }));
    // ymd を持たせる前に作られた記録（当日ぶん）
    const { ymd, ...noYmd } = trip({ status: 'done', returnAt: '11:00' });
    void ymd;
    await setDoc(doc(db, 'trips', 'today-legacy'), noYmd);
  });
});

describe('ログインしていない人・匿名', () => {
  it('読めない', async () => {
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'trips', 'today-done')));
  });
  it('匿名ログインでも読めない（設定を取り違えても記録は守られる）', async () => {
    await assertFails(getDoc(doc(asAnonymous(), 'trips', 'today-done')));
  });
});

describe('運転手', () => {
  it('当日の記録を作れる', async () => {
    await assertSucceeds(setDoc(doc(asPassword(DRIVER), 'trips', 'new'), trip()));
  });
  it('過去日の記録は作れない', async () => {
    await assertFails(setDoc(doc(asPassword(DRIVER), 'trips', 'new'),
      trip({ ymd: YESTERDAY, date: dateOf(new Date(Date.now() - 86400_000)) })));
  });
  it('いきなり完了した記録は作れない', async () => {
    await assertFails(setDoc(doc(asPassword(DRIVER), 'trips', 'new'),
      trip({ status: 'done', returnAt: '11:00' })));
  });

  it('当日の運行中の記録を直せる', async () => {
    await assertSucceeds(updateDoc(doc(asPassword(DRIVER), 'trips', 'today-running'), { departAt: '10:30' }));
  });
  it('当日の完了した記録も直せる', async () => {
    await assertSucceeds(updateDoc(doc(asPassword(DRIVER), 'trips', 'today-done'), { returnAt: '11:30' }));
  });
  it('当日の記録を消せる', async () => {
    await assertSucceeds(deleteDoc(doc(asPassword(DRIVER), 'trips', 'today-done')));
  });

  it('前日以前の記録は直せない', async () => {
    await assertFails(updateDoc(doc(asPassword(DRIVER), 'trips', 'yesterday'), { returnAt: '11:30' }));
  });
  it('前日以前の記録は消せない', async () => {
    await assertFails(deleteDoc(doc(asPassword(DRIVER), 'trips', 'yesterday')));
  });
  it('日付を別の日へ付け替えられない', async () => {
    await assertFails(updateDoc(doc(asPassword(DRIVER), 'trips', 'today-done'), { ymd: YESTERDAY }));
  });

  it('管理者の名簿には書けない（自分で管理者になれない）', async () => {
    await assertFails(setDoc(doc(asPassword(DRIVER), 'admins', DRIVER), {}));
  });
  it('マスタは読めるが書けない', async () => {
    await assertSucceeds(getDoc(doc(asPassword(DRIVER), 'config', 'master')));
    await assertFails(setDoc(doc(asPassword(DRIVER), 'config', 'master'), { drivers: ['x'] }));
  });

  it('ymd を持たない古い記録も、当日ぶんなら直せる', async () => {
    await assertSucceeds(updateDoc(doc(asPassword(DRIVER), 'trips', 'today-legacy'), { returnAt: '11:30' }));
  });
});

describe('管理者', () => {
  it('前日以前の記録も直せる', async () => {
    await assertSucceeds(updateDoc(doc(asPassword(ADMIN), 'trips', 'yesterday'), { returnAt: '11:30' }));
  });
  it('前日以前の記録を消せる', async () => {
    await assertSucceeds(deleteDoc(doc(asPassword(ADMIN), 'trips', 'yesterday')));
  });
  it('マスタを書ける', async () => {
    await assertSucceeds(setDoc(doc(asPassword(ADMIN), 'config', 'master'), { drivers: ['x'] }));
  });
  it('管理者の名簿にも書けない（コンソールからのみ）', async () => {
    await assertFails(setDoc(doc(asPassword(ADMIN), 'admins', 'someone'), {}));
  });
});
