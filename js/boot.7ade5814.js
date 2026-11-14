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
  const SIGNIN = ["vendor/supabase.d6a5c441.js", "js/config.a14912fe.js", "js/brand.80965af9.js", "js/util.1d5eb095.js", "js/privacy.2bf69cda.js", "js/auth.1e4f2997.js", "js/signin.41091fef.js"];
  const LAST = "js/main.cbbd09ad.js";
  // PERF3a: the demo's own code, loaded only when the page opens on a demo address (demo.js picks the demo client at load)
  const DEMO = ["js/demo.c6ed4293.js", "js/demo-wq-page.a8b05130.js", "js/demo-documents.6bf46a91.js", "js/plans/demo.0d0eeef6.js"];
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
  const preloaded = new Set();
  function preload(src) {
    if (preloaded.has(src)) return;
    preloaded.add(src);
    const l = document.createElement("link");
    l.rel = "preload"; l.as = "script"; l.href = src;
    document.head.appendChild(l);
  }
  const started = new Map();   // src -> promise of its load
  function script(src) {
    preload(src);
    if (!started.has(src)) started.set(src, new Promise((resolve, reject) => whenParsed(() => {
      const s = document.createElement("script");
      s.src = src; s.async = false;   // run in the order inserted
      s.onload = resolve; s.onerror = () => reject(new Error("Couldn't load " + src));
      document.body.appendChild(s);
    })));
    return started.get(src);
  }
  // The scripts the templates list, in order (with signin.js after privacy.js, where the sign-in set has it). PERF3a: the demo's own
  // code (DEMO) only when the page opened on a demo address; a real session never needs it (see below for entering one later).
  function scriptsInOrder() {
    const out = [];
    for (const t of files()) for (const n of t.content.querySelectorAll("script[data-src]")) {
      if (!demo && DEMO.includes(n.getAttribute("data-src"))) continue;
      out.push(n.getAttribute("data-src"));
      if (n.getAttribute("data-src") === "js/privacy.2bf69cda.js") out.push("js/signin.41091fef.js");
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
    // (the stylesheets' templates are further down the head than boot.js: they are put back once the page is parsed)
    const order = scriptsInOrder(), stylesLoaded = new Promise((resolve) => whenParsed(() => resolve(styles())));
    const before = order.filter((s) => s !== LAST);
    preload(LAST);   // main.js comes down with the rest and is run once the stylesheets are in
    const runs = before.map(script);
    // (a file that fails leaves this rejected: the page says to reload, since the files already run can't be run again in order)
    whole = Promise.all([stylesLoaded, ...runs]).then(() => script(LAST));
    return whole;
  }
  // Only the sign-in form's files; resolves once signin.js has run.
  function signIn() { return Promise.all(SIGNIN.map(script)); }

  // The service worker (sw.js) keeps the app's files for quick, flaky-coverage starts. Registered once the page is up and quiet,
  // so its download of every file never competes with the sign-in form or the first screen.
  function worker() {
    if (FP.demo?.active || !("serviceWorker" in navigator) || location.protocol !== "https:") return;
    const go = () => navigator.serviceWorker.register("sw.js").catch(() => {});
    const idle = () => (window.requestIdleCallback ? requestIdleCallback(go, { timeout: 5000 }) : setTimeout(go, 1000));
    if (document.readyState === "complete") idle(); else addEventListener("load", idle, { once: true });
  }

  const eager = demo || link || saved;
  FP.boot = { app, worker, eager, isDemo, SIGNIN, DEMO, loaded: () => !!whole };
  const failed = (text) => () => whenParsed(() => { const p = document.getElementById("loading"); if (p) p.textContent = text; });
  if (eager) app().catch(failed("The app couldn't load. Check your connection and reload the page."));
  else signIn().catch(failed("The sign-in page couldn't load. Check your connection and reload the page."));
})();
