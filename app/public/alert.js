/* 緊急対応中の帯と「🚨 緊急」ボタン（虎の巻など、送迎記録アプリの外の画面のためのもの）
 *
 * 1. 帯：送迎記録の「🚨 緊急」で立てた合図（Firestore の public/alert）を、
 *    ログイン無しで読んで画面の先頭に赤い帯を出す。合図には個人情報が入っていない
 *    （「緊急対応中かどうか」「開始時刻」「種別（ケガ・所在不明など）」だけ）。
 *    誰が・どこで・どの児童か、は送迎記録・Slack・電話で。
 * 2. ボタン：ページの中の data-yomicam-sos を付けた要素を押すと、送迎記録と同じ
 *    「🚨 緊急」の画面を開く（sos-widget.js）。帯の「対応・解決」も同じ画面を開く。
 *
 * 使い方：ページのどこかに1行足すだけ
 *   <script src="https://k-three.github.io/yomicam-driving/alert.js" defer></script>
 * ボタンを置くなら：<button data-yomicam-sos>🚨 緊急</button>
 *
 * 帯の確認は1分に1回（画面が見えているときだけ）。Firebase SDK は要らない。
 * 本文が丸ごと差し替わるページでも帯が消えないよう、無くなっていたら作り直す。 */
(function () {
  'use strict';
  var URL_ = 'https://firestore.googleapis.com/v1/projects/yomicam-driving/databases/(default)/documents/public/alert'
    + '?key=AIzaSyDdyi3BsybB1jb-Bd0d9OuW1se8up72Tvc';
  var POLL_MS = 60000;
  // 緊急の画面は、この alert.js と同じ場所に置いてある
  var me = document.currentScript && document.currentScript.src;
  var BASE = me ? me.replace(/alert\.js([?#].*)?$/, '') : 'https://k-three.github.io/yomicam-driving/';
  var WIDGET = BASE + 'sos-widget.js';
  var MOCK = /[?&]mock=1\b/.test(location.search);   // 自動テスト。本物の合図は読まない
  var state = null;   // { since: ms, sinceHm: 'HH:MM', kind: '' } or null
  var holdUntil = 0;  // この端末で操作した直後は、確認の結果で上書きしない（反映の遅れでちらつくため）

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
      // ページの CSS に左右されないよう、見た目は要素に直接書く
      el.style.cssText = 'position:sticky;top:0;z-index:9999;background:#B3261E;color:#fff;'
        + 'font:700 15px/1.5 system-ui,sans-serif;padding:10px 14px;text-align:center;'
        + 'box-shadow:0 2px 8px rgba(0,0,0,.25);display:flex;flex-wrap:wrap;gap:6px 12px;'
        + 'align-items:center;justify-content:center';
      var t = document.createElement('span');
      t.setAttribute('data-text', '');
      var b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('data-yomicam-sos', '');
      b.textContent = '対応・解決';
      b.style.cssText = 'all:unset;cursor:pointer;background:#fff;color:#B3261E;font:900 13px/1 system-ui,sans-serif;'
        + 'border-radius:999px;padding:7px 14px;white-space:nowrap';
      el.appendChild(t); el.appendChild(b);
      document.body.insertBefore(el, document.body.firstChild);
    }
    el.querySelector('[data-text]').textContent = '🚨 緊急対応中' + (state.kind ? '：' + state.kind : '') + '　'
      + (state.sinceHm || hm(state.since)) + '〜　' + elapsed(state.since)
      + '　詳細は送迎記録・Slack・電話で';
  }

  function poll() {
    if (MOCK || document.hidden) return;
    var x = new XMLHttpRequest();
    x.open('GET', URL_, true);
    x.onload = function () {
      try {
        if (Date.now() < holdUntil) return;
        if (x.status === 404) { state = null; render(); return; }
        if (x.status !== 200) return;              // 読めないときは前の状態を保つ
        var f = JSON.parse(x.responseText).fields || {};
        var active = f.active && f.active.booleanValue === true;
        if (!active) { state = null; render(); return; }
        var since = f.since && f.since.timestampValue ? Date.parse(f.since.timestampValue) : NaN;
        if (isNaN(since)) since = f.sinceMs ? Number(f.sinceMs.integerValue || f.sinceMs.doubleValue) : Date.now();
        state = { since: since, sinceHm: f.sinceHm && f.sinceHm.stringValue,
                  kind: f.kind && f.kind.stringValue };
        render();
      } catch (e) { /* 壊れた応答は無視して次を待つ */ }
    };
    x.send();
  }

  // ---- 「🚨 緊急」の画面（sos-widget.js）。押されたとき、または画面が落ち着いたあとに読む ----
  var loading = null;
  function load() {
    if (window.YomicamSos) return Promise.resolve(window.YomicamSos);
    if (!loading) loading = new Promise(function (ok, ng) {
      var s = document.createElement('script');
      s.src = WIDGET;
      s.onload = function () {
        if (window.YomicamSos) return ok(window.YomicamSos);
        // 開発サーバーでは部品を後から読み込むので、準備ができた合図を待つ
        var t = setTimeout(function () { loading = null; ng(new Error('no widget')); }, 15000);
        window.addEventListener('yomicam-sos-ready', function () { clearTimeout(t); ok(window.YomicamSos); }, { once: true });
      };
      s.onerror = function () { loading = null; ng(new Error('load failed')); };
      document.head.appendChild(s);
    });
    return loading;
  }
  function openSos() {
    load().then(function (w) { return w.open(); }).catch(function () {
      alert('緊急の画面を読み込めませんでした。電波を確認し、電話で連絡してください。');
    });
  }
  window.yomicamSos = { open: openSos };

  // 緊急の画面で出した・閉じた直後に、帯をすぐ切り替える
  window.addEventListener('yomicam-alert', function (e) {
    var d = e.detail || {};
    state = d.active ? { since: d.sinceMs, sinceHm: d.sinceHm, kind: d.kind } : null;
    holdUntil = Date.now() + 30000;
    render();
  });

  function start() {
    document.addEventListener('click', function (e) {
      var t = e.target && e.target.closest && e.target.closest('[data-yomicam-sos]');
      if (t) { e.preventDefault(); openSos(); }
    });
    poll();
    setInterval(poll, POLL_MS);
    // 帯が消されていたら作り直す。経過時間もここで進める
    setInterval(render, 5000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(); });
    // ボタンのあるページでは、押したときに待たせないよう、落ち着いてから先に読んでおく
    if (document.querySelector('[data-yomicam-sos]'))
      setTimeout(function () { load().catch(function () {}); }, 4000);
  }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();
