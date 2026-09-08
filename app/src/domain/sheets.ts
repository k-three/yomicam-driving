/** 帳票の「表」の定義。Excel も印刷用HTMLも、ここで作った同じ表から描く。
 *  2つの経路で列がずれないようにするため、表の形は1か所にまとめている。 */
import type { AlcoholCheck, Config, Trip } from './types';
import { BRACKETS, buildAlcoholReport, buildInsuranceReport, buildTripReport, summarize, totalCount } from './reports';
import { buildReview } from './review';
import { elapsed, hm } from './time';
import type { SheetSpec } from '../export/xlsx';

export type ReportKind = 'insurance' | 'alcohol' | 'trips' | 'review';

/** ダウンロードするファイル名は半角英数にしてある。
 *  ブラウザによっては日本語のファイル名が落ちて「download」という名前で
 *  保存されてしまうため（実測）。中身のシート名と表題は日本語のまま。 */
export const REPORT: Record<ReportKind, { label: string; file: string; note: string }> = {
  insurance: { label: '輸送記録（保険会社向け）', file: 'yomicam_insurance',
    note: '移動支援サービス専用自動車保険の月次通知。区間ごとに1行、学校での待機も1行として出します。' },
  alcohol: { label: 'アルコールチェック記録簿（安全運転管理者）', file: 'yomicam_alcohol',
    note: '運転者・1日で1行。保存義務は1年です。' },
  trips: { label: '運行日報（内部管理用）', file: 'yomicam_trips',
    note: '1運行1行。提出物ではなく、社内の確認用です。' },
  review: { label: '要確認一覧（提出前チェック）', file: 'yomicam_review',
    note: '誤入力・記録漏れの疑いを機械的に洗い出したものです。提出前にここを空にしてください。' },
};

export type Source = { trips: Trip[]; checks: AlcoholCheck[]; config: Config; ym: string };

const jpMonth = (ym: string) => `${ym.slice(0, 4)}年${Number(ym.slice(5, 7))}月`;

export function reportSheets(kind: ReportKind, src: Source): SheetSpec[] {
  const { trips, checks, config, ym } = src;
  const m = jpMonth(ym);

  if (kind === 'insurance') {
    const r = buildInsuranceReport(trips, config, ym);
    return [
      { name: '輸送記録', title: `${m}　輸送記録`,
        head: ['運転者', '自動車登録番号', '利用者', '出発地', '到着地',
               '開始日', '開始時刻', '終了日', '終了時刻', '所要時間', '備考'],
        rows: r.segments.map(s => [s.driver, s.regno, s.users, s.from, s.to,
                                   s.startDay, s.startAt, s.endDay, s.endAt, s.duration, s.note]) },
      { name: '時間区分集計', title: `${m}　運送時間の区分別件数`, landscape: false,
        head: ['時間区分', '件数'],
        rows: BRACKETS.map((b, i) => [b, r.counts[i] ?? 0]) },
      { name: '日別合計', title: `${m}　運転者・日別の運送時間`, landscape: false,
        head: ['日付', '運転者', '合計時間', '時間区分'],
        rows: r.daily.map(d => [d.date, d.driver, d.total, d.bracket]) },
    ];
  }

  if (kind === 'alcohol') {
    const rows = buildAlcoholReport(checks, ym);
    return [{
      name: 'アルコールチェック記録簿', title: `${m}　アルコールチェック記録簿`, landscape: false,
      head: ['日付', '運転者', '日常点検', '運転前 時刻', '運転前 結果',
             '運転後 時刻', '運転後 結果', '確認方法', '確認者', '備考'],
      rows: rows.map(r => [r.date, r.driver, r.inspection, r.preAt, r.preResult,
                           r.postAt, r.postResult, r.method, r.checker, r.note]),
    }];
  }

  if (kind === 'trips') {
    const list = buildTripReport(trips, ym);
    return [{
      name: '運行日報', title: `${m}　運行日報`,
      head: ['日付', '車両', '運転者', '出発地', '出発', '到着地', '到着', '所要時間',
             '乗車人数', '経由', '車内目視', 'コドモン', '特記'],
      rows: list.map(t => [t.date, t.vehicle, t.driver, t.base, t.departAt, t.dest, t.returnAt,
                           hm(elapsed(t.departAt, t.returnAt)), totalCount(t), summarize(t),
                           t.mokushi ? '済' : '', t.codomon ? '済' : '', t.note]),
    }];
  }

  const findings = buildReview(trips, checks, config, ym);
  return [{
    name: '要確認', title: `${m}　要確認一覧`,
    head: ['区分', '日付', '対象', '内容', '対応'],
    rows: findings.map(f => [f.severity, f.date, f.subject, f.what, f.how]),
  }];
}

export const reportFilename = (kind: ReportKind, ym: string) =>
  `${REPORT[kind].file}_${ym.replace('-', '')}.xlsx`;
