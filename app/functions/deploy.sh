#!/usr/bin/env bash
# Slack への自動投稿（Cloud Functions）を配置する。Google Cloud Shell で実行する想定。
#
#   (git -C yomicam-driving pull -q 2>/dev/null || git clone -q https://github.com/k-three/yomicam-driving) && bash yomicam-driving/app/functions/deploy.sh
#
# やること
#   1. Firestore の場所を調べ、関数を同じ場所に置く（違う場所だと動かない）
#   2. Slack の投稿先 URL がまだ登録されていなければ、入力を求めて Secret Manager に保存する
#      （画面には表示されない。このリポジトリにも残らない）
#   3. 関数を配置する
# 何度実行してもよい。2回目以降は 2 を飛ばす（URL を変えたいときは --reset-url を付ける）。
set -euo pipefail

PROJECT=yomicam-driving
HERE="$(cd "$(dirname "$0")" && pwd)"
FB="npx -y firebase-tools@latest"

echo "== 1/4 Firebase にログインしているか確認"
if ! $FB projects:list >/dev/null 2>&1; then
  echo "ログインが必要です。表示される URL を開き、出てきたコードをここに貼ってください。"
  $FB login --no-localhost
fi

echo "== 2/4 Firestore の場所を確認"
LOC=$(gcloud firestore databases describe --database='(default)' --project "$PROJECT" --format='value(locationId)')
case "$LOC" in
  nam5) REGION=us-central1 ;;
  eur3) REGION=europe-west1 ;;
  "")   echo "Firestore の場所を取得できませんでした。gcloud のログインを確認してください。"; exit 1 ;;
  *)    REGION=$LOC ;;
esac
echo "Firestore: $LOC → 関数の場所: $REGION"
echo "LOCATION=$REGION" > "$HERE/.env"

echo "== 3/4 Slack の投稿先 URL"
if [ "${1:-}" = "--reset-url" ] || ! gcloud secrets describe SLACK_WEBHOOK_URL --project "$PROJECT" >/dev/null 2>&1; then
  echo "Slack の Incoming Webhook URL（https://hooks.slack.com/services/... ）を貼り付けて Enter。"
  echo "入力した文字は画面に出ません。"
  $FB functions:secrets:set SLACK_WEBHOOK_URL --project "$PROJECT"
else
  echo "登録済み（変えるときは: bash $0 --reset-url）"
fi

echo "== 4/4 関数を配置（初回は数分かかります）"
cd "$HERE" && npm ci --silent
cd "$HERE/.." && $FB deploy --only functions --project "$PROJECT" --force

echo
echo "完了しました。送迎記録の管理画面で「🚨 緊急」→「緊急対応中にする」を押すと、"
echo "Slack に一報が出ます。試したあとは「対応・解決」→「誤報だった（取り消す）」で閉じてください。"
