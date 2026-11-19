// SI1 (sign-in first): what the page loads, and when. It runs early in the head, after the scripts' template and before the
// stylesheets (a script after a stylesheet waits for it), so every file it needs is asked for at once (a preload, while the rest of
// the page is still arriving) and run once the screens are parsed. A signed-out visitor needs only the sign-in form, so the page
// asks for only the files it uses (SIGNIN below: the Auth client, the settings, the brand words, the helpers, sign-in, the privacy note)
// and the three base stylesheets in the head. Everything else (the map library, the viewer, people, water quality, records and
// so on) is listed in index.html inside <template> elements, by data-src and data-href (never src or href: Chrome's look-ahead
// scanner was seen fetching a template's <script src> on a slow connection), and is loaded by app():
//   - at once, when the page already looks signed in (a saved session), opens the demo or carries an emailed sign-in link: every
//     file in the page's own order, all asked for together and run in that order (no chain of one file after another);
//   - after sign-in otherwise (signin.js calls app()).
// The stylesheets go back where their template stands, so the cascade is the one the page always had. main.js is asked for with
// the rest but run only once the stylesheets have loaded, so the first screen after sign-in is never drawn unstyled.
// Every name here is a quoted path, so build.sh's content hashing (hash-files.cjs) rewrites it with the files' new names.
(() => {
  const FP = (window.FP = window.FP || {});
  const SIGNIN = ["vendor/supabase.d6a5c441.js", "js/config.83f2160d.js", "js/brand.80965af9.js", "js/util.1d5eb095.js", "js/privacy.6b656fd5.js", "js/auth.1e4f2997.js", "js/signin.59c973f3.js"];
  const LAST = "js/main.6165da77.js";
  const LATER_STYLES = ["css/app.0f857b15.css", "css/ui.eb0ff89f.css"];   // SI2: in the stylesheets' templates (signin-first.test.cjs keeps them in step)
  // PERF3a: the demo's own code, loaded only when the page opens on a demo address (demo.js picks the demo client at load)
  const DEMO = ["js/demo.ed2452e8.js", "js/demo-wq-page.a8b05130.js", "js/demo-documents.6bf46a91.js", "js/plans/demo.3d6e5819.js"];
  const hash = location.hash || "";
  const isDemo = (h) => /^#\/demo(?:\/|\?|$)/.test(h || "");
  const demo = isDemo(hash);
  // A demo address entered later starts a fresh page, which loads the demo (demo.js did this when it was always loaded; this listener
  // is added first, so it still comes before the app's own)
  if (!demo) addEventListener("hashchange", (event) => { if (isDemo(location.hash)) { event.stopImmediatePropagation(); location.reload(); } });
  const link = /(?:^#|&)(?:access_token|error|error_code)=/.test(hash);
  // A saved session (the Auth client keeps it as sb-<project>-auth-token): most likely signed in, so the app is loaded straight away.
  // Only a hint: signin.js still asks the Auth client, and a session this misses loads the app from there.
  let saved = false;
  try { for (let i = 0; i < localStorage.length; i++) if (/^sb-.+-auth-token$/.test(localStorage.key(i) || "")) saved = true; } catch { /* no storage: signed out */ }

  const files = () => [...document.querySelectorAll("template[data-app-files]")];
  // boot.js runs in the head: each file is asked for at once (a preload), and run once the page's screens are parsed
  const whenParsed = (f) => (document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", f, { once: true }) : f());
  // PUB2: the host sometimes answers one file with a 503 for a few seconds just after a publish. A script file that would not come
  // (no answer, or 500 and over) is asked for again up to RETRY.length more times, after these waits, before the page says it
  // couldn't load. A file that isn't there (404 and the like: a page kept from before a publish, PUB1) is not asked for again.
  // So the order never changes, a script goes into the page only once its download is in and every script before it is in the page:
  // the browser still asks for every file at once (the preloads) and runs them in the order they were put in.
  const RETRY = [500, 1500, 3000];
  let canPreload = false;
  try { canPreload = !!document.createElement("link").relList?.supports?.("preload"); } catch { /* no preload: put in at once, as before */ }
  const fetched = new Map();   // script src -> { url, ok, bad, tries, in, s, resolve, reject, promise }
  const queue = [];            // the scripts in the order they were asked for, which is the order they run in
  let parsed = false;
  whenParsed(() => { parsed = true; pump(); });
  const preloaded = new Set();
  function preload(src, as = "script") {
    if (preloaded.has(src)) return;
    preloaded.add(src);
    const l = document.createElement("link");
    l.rel = "preload"; l.as = as; l.href = src;
    if (as === "script") {
      const f = entry(src);
      if (canPreload) {
        l.onload = () => { l.onload = l.onerror = null; f.ok = true; pump(); };
        l.onerror = () => { l.onload = l.onerror = null; l.remove(); again(f); };
      } else f.ok = true;
    }
    document.head.appendChild(l);
  }
  function entry(src) {
    if (!fetched.has(src)) {
      const f = { src, url: src, ok: false, bad: false, tries: 0, in: false, s: null };
      f.promise = new Promise((resolve, reject) => { f.resolve = resolve; f.reject = reject; });
      fetched.set(src, f);
    }
    return fetched.get(src);
  }
  function give(f) { if (f.bad) return; f.bad = true; f.reject(new Error("Couldn't load " + f.src)); }
  // the download failed: wait, ask again past any kept answer (the same file, with ?retry=n), and go on by what the host says
  function again(f) {
    if (f.bad) return;
    if (f.tries >= RETRY.length || typeof fetch !== "function") { give(f); return; }
    const n = ++f.tries, url = f.src + "?retry=" + n;
    setTimeout(() => {
      fetch(url, { cache: "reload" }).then((r) => {
        if (r.ok) { f.url = url; f.ok = true; pump(); } else if (r.status >= 500) again(f); else give(f);   // (a 404: gone, PUB1)
      }, () => again(f));
    }, RETRY[n - 1]);
  }
  // put in, in order, every script whose download is in, up to the first that isn't
  function pump() {
    if (!parsed) return;
    for (const f of queue) {
      if (f.in) continue;
      if (!f.ok || f.bad) return;
      const s = document.createElement("script");
      s.src = f.url; s.async = false;   // run in the order inserted
      f.in = true; f.s = s;
      s.onload = () => { s.onload = s.onerror = null; f.resolve(); };
      s.onerror = () => {
        s.onload = s.onerror = null; s.remove();
        // asked for again only while no later script is in the page (one is, it would run first: the order would change)
        if (queue.slice(queue.indexOf(f) + 1).some((g) => g.in)) give(f); else { f.in = false; f.ok = false; again(f); }
      };
      document.body.appendChild(s);
    }
  }
  function script(src) {
    preload(src);
    const f = entry(src);
    if (!queue.includes(f)) { queue.push(f); pump(); }
    return f.promise;
  }
  // The scripts the templates list, in order (with signin.js after privacy.js, where the sign-in set has it). PERF3a: the demo's own
  // code (DEMO) only when the page opened on a demo address; a real session never needs it (see below for entering one later).
  function scriptsInOrder() {
    const out = [];
    for (const t of files()) for (const n of t.content.querySelectorAll("script[data-src]")) {
      if (!demo && DEMO.includes(n.getAttribute("data-src"))) continue;
      out.push(n.getAttribute("data-src"));
      if (n.getAttribute("data-src") === "js/privacy.6b656fd5.js") out.push("js/signin.59c973f3.js");
    }
    return out;
  }
  // Each template's stylesheets put in its place, then the template removed; resolves when they have loaded (or failed: a missing
  // stylesheet never keeps anyone out)
  function styles() {
    const loads = [];
    for (const t of files()) {
      const links = [...t.content.querySelectorAll("link[rel=stylesheet][data-href]")].map((n) => {
        const l = document.createElement("link");
        for (const a of n.attributes) if (a.name !== "data-href") l.setAttribute(a.name, a.value);
        l.setAttribute("href", n.getAttribute("data-href"));
        loads.push(new Promise((resolve) => { l.onload = l.onerror = resolve; }));
        return l;
      });
      t.replaceWith(...links);
    }
    return Promise.all(loads);
  }

  let whole = null;
  // Loads the rest of the app; resolves once main.js has run (it starts the app itself). Safe to call more than once.
  function app() {
    if (whole) return whole;
    // SI2: the shared look's signed-in part (the largest held-back stylesheets) downloads beside the scripts at once, as it did when
    // the page linked it; its templates are further down the head, so their links are put in place once the page is parsed.
    // (review F3: before stylesLoaded, whose links go in at once on a sign-in; a preload put in after them is a second download in WebKit)
    for (const s of LATER_STYLES) preload(s, "style");
    // (the stylesheets' templates are further down the head than boot.js: they are put back once the page is parsed)
    const order = scriptsInOrder(), stylesLoaded = new Promise((resolve) => whenParsed(() => resolve(styles())));
    const before = order.filter((s) => s !== LAST);
    preload(LAST);   // main.js comes down with the rest and is run once the stylesheets are in
    const runs = before.map(script);
    // (a file that fails leaves this rejected: the page says to reload, since the files already run can't be run again in order)
    whole = Promise.all([stylesLoaded, ...runs]).then(() => script(LAST)).then(reserveTop);
    return whole;
  }
  // Only the sign-in form's files; resolves once signin.js has run.
  function signIn() { return Promise.all(SIGNIN.map(script)); }

  // The service worker (sw.js) keeps the app's files for quick, flaky-coverage starts. Registered once the page is up and quiet,
  // so its download of every file never competes with the sign-in form or the first screen.
  function worker() {
    if (FP.demo?.active || !("serviceWorker" in navigator) || location.protocol !== "https:") return;
    const go = () => navigator.serviceWorker.register("sw.js").then((reg) => { if (!watched) watched = watch(reg, navigator.serviceWorker); }).catch(() => {});
    const idle = () => (window.requestIdleCallback ? requestIdleCallback(go, { timeout: 5000 }) : setTimeout(go, 1000));
    if (document.readyState === "complete") idle(); else addEventListener("load", idle, { once: true });
  }

  // PERF3e: a new version noticed by an open app; one line offers Reload (app/README.md)
  const CHECK_EVERY = 15 * 60 * 1000;
  let watched = null;
  function reserveTop() {
    const root = document.documentElement, banner = document.querySelector(".demo-banner"), line = document.querySelector(".nv-line:not([hidden])");
    const b = banner ? banner.getBoundingClientRect().height : 0, l = line ? line.getBoundingClientRect().height : 0;
    root.style.setProperty("--nv-top", b + "px");
    root.style.setProperty("--nv-h", l + "px");
    root.classList.toggle("nv-on", !!line);
    root.classList.toggle("nv-keep", !!line && !!FP.mapKeep?.affected?.());
    if (banner || line) root.style.setProperty("--demo-banner-height", b + l + "px"); else root.style.removeProperty("--demo-banner-height");
  }
  // its look (css/new-version.css) is loaded when first needed; on a failed load no line, tried again later (app/README.md)
  let nvCss = 0, nvRetry = 0;
  const calm = (f) => { const c = FP.mapHandoff?.settled?.(); if (c) c.then(f); else f(); };
  function showLine(reload) {
    let line = document.querySelector(".nv-line");
    if (line) { line.hidden = false; reserveTop(); return; }
    if (nvCss < 2) {
      if (nvCss) return;
      nvCss = 1;
      const css = document.createElement("link");
      css.rel = "stylesheet"; css.href = "css/new-version.541cf0f9.css";
      css.onload = () => { nvCss = 2; calm(() => showLine(reload)); };
      css.onerror = () => { css.remove(); nvCss = 0; nvRetry = 1; };
      document.head.append(css);
      return;
    }
    const mk = (tag, cls, attrs = {}) => { const n = document.createElement(tag); n.className = cls; for (const k in attrs) n.setAttribute(k, attrs[k]); return n; };
    const ns = "http://www.w3.org/2000/svg", x = document.createElementNS(ns, "svg"), p = document.createElementNS(ns, "path");
    for (const [n, a] of [[x, { viewBox: "0 0 24 24", width: 20, height: 20, "aria-hidden": "true" }], [p, { d: "M6 6l12 12M18 6L6 18", stroke: "currentColor", "stroke-width": 1.8, "stroke-linecap": "round", fill: "none" }]]) for (const k in a) n.setAttribute(k, a[k]);
    x.append(p);
    line = mk("aside", "nv-line", { "aria-label": "New version" });
    const words = mk("p", "nv-words", { role: "status", "aria-live": "polite" }), again = mk("button", "nv-reload", { type: "button" }), close = mk("button", "nv-close", { type: "button", "aria-label": "Dismiss" });
    again.textContent = "Reload";
    again.onclick = () => reload();
    close.append(x);
    close.onclick = () => { line.hidden = true; calm(reserveTop); };
    line.append(words, again, close);
    document.body.append(line);
    setTimeout(() => { words.textContent = "A new version is ready."; reserveTop(); }, 50);
    reserveTop();
    if (window.ResizeObserver) new ResizeObserver(() => line.hidden || reserveTop()).observe(line);
  }
  function watch(reg, sw, { now = () => Date.now(), reload = () => location.reload(), doc = document } = {}) {
    let checked = now(), had = !!sw?.controller;
    const done = { checks: 0, shown: 0 }, show = () => whenParsed(() => calm(() => showLine(reload)));
    doc.addEventListener("visibilitychange", () => {
      if (doc.visibilityState !== "visible") return;
      if (nvRetry) { nvRetry = 0; show(); }
      if (now() - checked < CHECK_EVERY) return;
      checked = now();
      done.checks++;
      try { Promise.resolve(reg?.update?.()).catch(() => {}); } catch { /* next open */ }
    });
    sw?.addEventListener?.("controllerchange", () => {
      // (never in the middle of a move from map to map (TR1): the boxes the picture handed over lies on would move under it)
      if (had) { done.shown++; show(); }
      had = true;
    });
    return done;
  }

  // PUB1: a file the page names that would not load (most often a page kept from before a publish, for up to ten minutes, naming
  // files that publish replaced). The words say so calmly, with Reload: one reload of this address past every copy of the page held
  // on the way (a new ?fresh= each tap, so neither the browser nor the host can answer with the kept page). Only on a tap: nothing
  // reloads by itself. A second failure, on a page reloaded that way, says to wait a few minutes. index.html's own small script
  // (after this file) says the same when this file itself never runs.
  const FRESH = "fresh";
  function freshHref(href = location.href) { const u = new URL(href); u.searchParams.set(FRESH, Date.now().toString(36)); return u.href; }
  function couldNotLoad(text) {
    const p = document.getElementById("loading");
    if (!p) return;
    const again = new URL(location.href).searchParams.has(FRESH);
    const words = document.createElement("span"), reload = document.createElement("button");
    words.textContent = again ? text.replace(/ and reload the page\.$/, ", wait a few minutes and try again.") : text;
    reload.type = "button"; reload.className = "loading-reload"; reload.textContent = "Reload";
    reload.addEventListener("click", () => location.replace(freshHref()));
    p.className = "loading loading-failed"; p.setAttribute("role", "alert");
    p.replaceChildren(words, reload);
    for (const s of document.querySelectorAll("body > main, #screen-map")) s.hidden = true;
    p.hidden = false;
  }
  // once the app has loaded, the address loses the ?fresh= a Reload added (the rest of it, and the route, as they were)
  function tidy() {
    const u = new URL(location.href);
    if (!u.searchParams.has(FRESH)) return;
    u.searchParams.delete(FRESH);
    try { history.replaceState(history.state, "", u.pathname + u.search + u.hash); } catch { /* the address stays as it is */ }
  }

  const eager = demo || link || saved;
  FP.boot = { app, worker, watch, reserveTop, eager, isDemo, SIGNIN, DEMO, LATER_STYLES, CHECK_EVERY, RETRY, loaded: () => !!whole, couldNotLoad, freshHref };
  const failed = (text) => () => whenParsed(() => couldNotLoad(text));
  if (eager) app().then(tidy, failed("The app couldn't load. Check your connection and reload the page."));
  else signIn().then(tidy, failed("The sign-in page couldn't load. Check your connection and reload the page."));
})();
