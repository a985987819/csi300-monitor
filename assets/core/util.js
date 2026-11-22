/* ═══════════ 共享工具库（全模块复用，先于 shell/router 加载） ═══════════
   各模块以别名引用保持调用点不变：var $ = Util.$, esc = Util.esc …
   localStorage 一律走 Util.store（JSON 安全 + 配额异常吞掉不上抛）。 */
(function () {
  "use strict";

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function debounce(fn, ms) {
    var t = null;
    return function () {
      var self = this, args = arguments;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }

  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  /* ── localStorage JSON 安全封装 ── */
  var store = {
    get: function (key, fallback) {
      try {
        var raw = localStorage.getItem(key);
        if (raw === null) return fallback === undefined ? null : fallback;
        return JSON.parse(raw);
      } catch (e) { return fallback === undefined ? null : fallback; }
    },
    set: function (key, val) {
      try { localStorage.setItem(key, JSON.stringify(val)); return true; }
      catch (e) { return false; }
    },
    merge: function (key, patch) {
      var cur = store.get(key, {});
      if (!cur || typeof cur !== "object") cur = {};
      Object.keys(patch).forEach(function (k) { cur[k] = patch[k]; });
      store.set(key, cur);
      return cur;
    }
  };

  /* ── 脚本注入（路由 chunk / JSONP 共用底层） ── */
  function loadScript(src, opts) {
    opts = opts || {};
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src;
      if (opts.charset) s.charset = opts.charset;
      s.onload = function () { resolve(); };
      s.onerror = function () {
        s.parentNode && s.parentNode.removeChild(s);
        reject(new Error("脚本加载失败：" + src));
      };
      (opts.parent || document.head).appendChild(s);
    });
  }

  window.Util = { $: $, esc: esc, debounce: debounce, pad2: pad2, store: store, loadScript: loadScript };
})();
