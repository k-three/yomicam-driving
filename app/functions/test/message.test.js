import { describe, expect, it } from 'vitest';
import { closeText, isAllowedWebhook, raiseText, slackEscape } from '../message.js';

const inc = {
  startedAt: '14:32', startedMs: Date.UTC(2026, 9, 6, 5, 32), driver: '運転者H', vehicle: 'パッソ',
  place: '渡慶次小学校', riders: ['そら'], note: '下校時刻を20分過ぎても来ない',
  status: 'open', outcome: '', closedAt: '', closedMs: 0, closedBy: '', closedNote: '',
};

describe('Slack の一報', () => {
  it('チャンネル全員に通知し、時刻・場所・人・児童・状況を1通にまとめる', () => {
    const t = raiseText(inc, inc.startedMs + 5_000);
    expect(t.startsWith('<!channel> 🚨 *緊急対応中*（14:32〜）')).toBe(true);
    expect(t).toContain('場所：渡慶次小学校');
    expect(t).toContain('発信：運転者H／車両：パッソ');
    expect(t).not.toContain('虎の巻から');
    expect(t).toContain('来ていない・所在不明：*そら*');
    expect(t).toContain('状況：下校時刻を20分過ぎても来ない');
    expect(t).toContain('<https://k-three.github.io/yomicam-driving/admin.html|送迎記録>');
    expect(t).not.toContain('遅れて');
  });
  it('種別を見出しに出し、対象の児童の言い方を種別に合わせる', () => {
    const t = raiseText({ ...inc, kind: 'ケガ', riders: ['りおん'] }, inc.startedMs);
    expect(t.startsWith('<!channel> 🚨 *緊急：ケガ*（14:32〜）')).toBe(true);
    expect(t).toContain('ケガをした児童：*りおん*');
    expect(raiseText({ ...inc, kind: '所在不明' }, inc.startedMs)).toContain('来ていない・所在不明：*そら*');
    expect(raiseText({ ...inc, kind: '交通事故' }, inc.startedMs)).toContain('関係する児童：*そら*');
    expect(raiseText({ ...inc, kind: '体調不良' }, inc.startedMs)).toContain('具合が悪い児童：*そら*');
  });
  it('虎の巻から出したら、そう書く（車両は無い）', () => {
    const t = raiseText({ ...inc, kind: '所在不明', via: '虎の巻', driver: 'はあと', vehicle: '', place: '読谷村文化センター' }, inc.startedMs);
    expect(t).toContain('発信：はあと（虎の巻から）');
    expect(t).toContain('場所：読谷村文化センター');
  });
  it('種別を持たない古い記録は、これまでどおりの見出し', () => {
    expect(raiseText(inc, inc.startedMs).startsWith('<!channel> 🚨 *緊急対応中*（14:32〜）')).toBe(true);
  });
  it('電波が悪くて遅れて届いたら、そのことを書く', () => {
    expect(raiseText(inc, inc.startedMs + 18 * 60_000)).toContain('押してから18分遅れて届きました');
  });
  it('入力欄に一斉通知や書式を仕込めない', () => {
    const t = raiseText({ ...inc, note: '<!everyone> <https://x|y> & z' }, inc.startedMs);
    expect(t).toContain('状況：&lt;!everyone&gt; &lt;https://x|y&gt; &amp; z');
    expect(t.match(/<!/g)).toHaveLength(1);   // 先頭の <!channel> だけ
    expect(slackEscape('a<b>&')).toBe('a&lt;b&gt;&amp;');
  });
  it('場所や児童が無くても崩れない', () => {
    const t = raiseText({ ...inc, place: '', riders: [], note: '', vehicle: '' }, inc.startedMs);
    expect(t).toContain('場所：（未入力）');
    expect(t).not.toContain('来ていない');
    expect(t).not.toContain('状況：');
  });
});

describe('解決・取り消しのお知らせ', () => {
  it('解決は ✅、対応時間と内容を書く', () => {
    const t = closeText({ ...inc, status: 'closed', outcome: 'resolved', closedAt: '14:51',
      closedMs: inc.startedMs + 19 * 60_000, closedBy: '管理者', closedNote: '保護者が先に迎えに来ていた' });
    expect(t).toContain('✅ *解決*（14:51・管理者）');
    expect(t).toContain('14:32 に出た緊急対応（渡慶次小学校）　対応時間 19分');
    expect(closeText({ ...inc, kind: 'ケガ', status: 'closed', outcome: 'resolved', closedAt: '14:51',
      closedMs: inc.startedMs + 60_000, closedBy: '管理者' })).toContain('14:32 に出た緊急対応（ケガ・渡慶次小学校）');
    expect(t).toContain('内容：保護者が先に迎えに来ていた');
  });
  it('取り消しは誤報と分かるように書く', () => {
    const t = closeText({ ...inc, status: 'closed', outcome: 'cancelled', closedAt: '14:35',
      closedMs: inc.startedMs + 3 * 60_000, closedBy: '運転者H' });
    expect(t).toContain('↩️ *誤報として取り消し*（14:35・運転者H）');
  });
});

describe('投稿先 URL', () => {
  it('Slack の Incoming Webhook だけを受け付ける', () => {
    expect(isAllowedWebhook('https://hooks.slack.com/services/T000/B000/xxxxXXXX')).toBe(true);
    expect(isAllowedWebhook('https://evil.example.com/services/T000')).toBe(false);
    expect(isAllowedWebhook('http://hooks.slack.com/services/T000/B000/x')).toBe(false);
    expect(isAllowedWebhook('')).toBe(false);
  });
  it('手元のサーバーはエミュレータでの試験に限って許す', () => {
    expect(isAllowedWebhook('http://127.0.0.1:8099/hook')).toBe(false);
    expect(isAllowedWebhook('http://127.0.0.1:8099/hook', true)).toBe(true);
  });
});
