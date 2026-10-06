/** Cloud Functions の通し試験。Functions と Firestore のエミュレータの上で、
 *  incidents に書く → 関数が動く → Slack（手元の偽サーバー）に届く → 結果が書き戻る、
 *  までを本物と同じ経路で確かめる。
 *
 *  実行：npm run test:functions   （app/ で） */
import http from 'node:http';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../package.json', import.meta.url));
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const got = [];
let failNext = false;
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    got.push(JSON.parse(body).text);
    if (failNext) { failNext = false; res.writeHead(500); res.end('boom'); return; }
    res.writeHead(200); res.end('ok');
  });
});
await new Promise(r => server.listen(8099, '127.0.0.1', r));

initializeApp({ projectId: 'demo-yomicam' });
const db = getFirestore();

const until = async (fn, what, ms = 30_000) => {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`待っても来なかった：${what}`);
    await new Promise(r => setTimeout(r, 300));
  }
};

const base = {
  date: '2026-10-06', ymd: 20261006, startedAt: '14:32', startedMs: Date.now(),
  driver: '運転者H', vehicle: 'パッソ', place: '渡慶次小学校', riders: ['そら'], note: '来ない',
  status: 'open', outcome: '', closedAt: '', closedMs: 0, closedBy: '', closedNote: '', createdBy: 'u',
};

let ok = 0;
const check = async (name, fn) => { await fn(); ok++; console.log(`  ✓ ${name}`); };

try {
  await check('緊急対応を立てると、Slack に一報が届き、結果が書き戻る', async () => {
    const ref = db.collection('incidents').doc('e2e-1');
    await ref.set(base);
    const slack = await until(async () => (await ref.get()).data().slack, 'slack 欄');
    assert.equal(slack.ok, true);
    assert.equal(got.length, 1);
    assert.match(got[0], /^<!channel> 🚨 \*緊急対応中\*（14:32〜）/);
    assert.match(got[0], /来ていない・所在不明：\*そら\*/);
  });

  await check('書き戻しで2通目は出ない（自分の書き込みで再び動いても投稿しない）', async () => {
    await new Promise(r => setTimeout(r, 2500));
    assert.equal(got.length, 1);
  });

  await check('解決すると、お知らせが1通だけ届く', async () => {
    const ref = db.collection('incidents').doc('e2e-1');
    await ref.update({ status: 'closed', outcome: 'resolved', closedAt: '14:51',
      closedMs: base.startedMs + 19 * 60_000, closedBy: '管理者', closedNote: '保護者が迎えに来ていた' });
    await until(async () => (await ref.get()).data().slack?.closed === true, '解決の書き戻し');
    assert.equal(got.length, 2);
    assert.match(got[1], /✅ \*解決\*（14:51・管理者）/);
    await new Promise(r => setTimeout(r, 2500));
    assert.equal(got.length, 2);
  });

  await check('Slack が失敗を返したら、失敗として書き戻す（画面で手動投稿を促すため）', async () => {
    failNext = true;
    const ref = db.collection('incidents').doc('e2e-2');
    await ref.set({ ...base, startedMs: Date.now() });
    const slack = await until(async () => (await ref.get()).data().slack, 'slack 欄（失敗）');
    assert.equal(slack.ok, false);
    assert.match(slack.error, /500/);
  });

  console.log(`\n${ok} passed`);
} finally {
  server.close();
}
