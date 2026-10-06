/* 緊急対応中の帯（虎の巻など、送迎記録アプリの外の画面に出すためのもの）
 *
 * 送迎記録アプリの「🚨 緊急」で立てた合図（Firestore の public/alert）を、
 * ログイン無しで読んで画面の先頭に赤い帯を出す。合図には個人情報が入っていない
 * （「緊急対応中かどうか」と「開始時刻」だけ）。詳細は送迎記録アプリと電話で。
 *
 * 使い方：ページのどこかに1行足すだけ
 *   <script src="https://k-three.github.io/yomicam-driving/alert.js" defer></script>
 *
 * 1分に1回読みに行く（画面が見えているときだけ）。Firebase SDK は要らない。
 * 本文が丸ごと差し替わるページ（復号して表示する配布ページ）でも帯が消えないよう、
 * 無くなっていたら作り直す。 */
(function () {
  'use strict';
  var URL_ = 'https://firestore.googleapis.com/v1/projects/yomicam-driving/databases/(default)/documents/public/alert'
    + '?key=AIzaSyDdyi3BsybB1jb-Bd0d9OuW1se8up72Tvc';
  var POLL_MS = 60000;
  var state = null;   // { since: ms, sinceHm: 'HH:MM' } or null

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function hm(ms) { var d = new Date(ms); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function elapsed(ms) {
    var min = Math.max(0, Math.floor((Date.now() - ms) / 60000));
    return min < 60 ? min + '分経過' : Math.floor(min / 60) + '時間' + (min % 60) + '分経過';
  }

  function render() {
    var el = document.getElementById('yomicam-alert');
    if (!state) { if (el) el.parentNode.removeChild(el); return; }
    if (!el) {
      el = document.createElement('div');
      el.id = 'yomicam-alert';
      el.setAttribute('role', 'alert');
      // head が差し替わるページでも効くよう、見た目は要素に直接書く
      el.style.cssText = 'position:sticky;top:0;z-index:9999;background:#B3261E;color:#fff;'
        + 'font:700 15px/1.5 system-ui,sans-serif;padding:10px 14px;text-align:center;'
        + 'box-shadow:0 2px 8px rgba(0,0,0,.25)';
      document.body.insertBefore(el, document.body.firstChild);
    }
    el.textContent = '🚨 緊急対応中　' + (state.sinceHm || hm(state.since)) + '〜　' + elapsed(state.since)
      + '　詳細は送迎記録アプリ・電話で';
  }

  function poll() {
    if (document.hidden) return;
    var x = new XMLHttpRequest();
    x.open('GET', URL_, true);
    x.onload = function () {
      try {
        if (x.status === 404) { state = null; render(); return; }
        if (x.status !== 200) return;              // 読めないときは前の状態を保つ
        var f = JSON.parse(x.responseText).fields || {};
        var active = f.active && f.active.booleanValue === true;
        if (!active) { state = null; render(); return; }
        var since = f.since && f.since.timestampValue ? Date.parse(f.since.timestampValue) : NaN;
        if (isNaN(since)) since = f.sinceMs ? Number(f.sinceMs.integerValue || f.sinceMs.doubleValue) : Date.now();
        state = { since: since, sinceHm: f.sinceHm && f.sinceHm.stringValue };
        render();
      } catch (e) { /* 壊れた応答は無視して次を待つ */ }
    };
    x.send();
  }

  function start() {
    poll();
    setInterval(poll, POLL_MS);
    // 帯が消されていたら作り直す。経過時間もここで進める
    setInterval(render, 5000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(); });
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
