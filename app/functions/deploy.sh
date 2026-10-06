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
# 途中で止めたいときは Ctrl+C（Ctrl+Z は「一時停止」なので、止まったまま残る）。
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
  # 聞くのはこのスクリプト自身。すぐに入力欄を出し、打った文字は画面に出さない。
  # （以前は firebase の準備を待つ間に貼られてしまい、URL が画面に出ることがあった）
  while :; do
    printf '\nSlack の Incoming Webhook URL を貼り付けて Enter（画面には出ません）\nURL: '
    IFS= read -rs URL; echo
    URL=$(printf '%s' "$URL" | tr -d '[:space:]')
    case "$URL" in
      https://hooks.slack.com/services/?*) break ;;
      "") echo "何も入力されていません。もう一度貼り付けてください。" ;;
      *)  echo "形が違います。https://hooks.slack.com/services/ で始まる URL を貼り付けてください。" ;;
    esac
  done
  printf '%s' "$URL" | $FB functions:secrets:set SLACK_WEBHOOK_URL --project "$PROJECT" --data-file=- --non-interactive
  unset URL
  echo "登録しました（URL は Google の Secret Manager にだけ保存されています）"
else
  echo "登録済み（変えるときは: bash $0 --reset-url）"
fi

echo "== 4/4 関数を配置（初回は数分かかります）"
cd "$HERE" && npm ci --silent
cd "$HERE/.."
# 初めて配置するときは、Google 側の権限（Eventarc）の反映が間に合わずに失敗することがある。
# そのときは数分待てば通るので、ここで待ってやり直す（最大3回）
LOG=$(mktemp)
for attempt in 1 2 3 4; do
  if $FB deploy --only functions --project "$PROJECT" --force 2>&1 | tee "$LOG"; then
    rm -f "$LOG"; break
  fi
  if [ "$attempt" -lt 4 ] && grep -qiE "eventarc|propagat|first time using 2nd gen" "$LOG"; then
    echo
    echo "初回によくある「権限の反映待ち」です。3分待ってから、もう一度試します（${attempt}/3）。"
    echo "このまま待ってください（閉じたり Ctrl+C を押したりしないでください）。"
    sleep 180
    continue
  fi
  rm -f "$LOG"
  echo
  echo "配置できませんでした。上のエラーを送ってください。"
  echo "「Eventarc」の権限エラーが続くときは、次の1行を実行してから、もう一度このスクリプトを実行してください："
  NUM=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
  echo "  gcloud projects add-iam-policy-binding $PROJECT --member=serviceAccount:service-${NUM}@gcp-sa-eventarc.iam.gserviceaccount.com --role=roles/eventarc.serviceAgent"
  exit 1
done

echo
echo "完了しました。送迎記録の管理画面で「🚨 緊急」→「緊急対応中にする」を押すと、"
echo "Slack に一報が出ます。試したあとは「対応・解決」→「誤報だった（取り消す）」で閉じてください。"
