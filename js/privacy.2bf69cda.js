// V8 step 4: the privacy and terms note. Its words are one file, app/privacy-terms.md, that RCL can reword without touching code:
// a "version:" line between two "---" lines at the top, then headings (# and ##), paragraphs, and lists ("- "), shown as plain
// text (no markup, links or script is ever made from it). Route #/privacy, open to everyone, signed in or not (simple-view.js's
// CLIENT_PAGES lets a client reach it).
// The first sign-in acknowledgement: after signing in, a person who has not acknowledged the note's current version sees it once,
// with I understand, and the acknowledgement is recorded in public.privacy_acknowledgements (their own row only; RCL staff read
// all). A new version in the file asks everyone again. It never keeps anyone out: if the note or the record can't be read, or the
// record can't be written, the person goes on and is asked again next time.
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else { root.FP = root.FP || {}; root.FP.privacy = api; }
})(typeof window === "undefined" ? globalThis : window, function (root) {
  const FILE = "privacy-terms.md", TABLE = "privacy_acknowledgements", ROUTE = "#/privacy";
  const VERSION = /^[0-9A-Za-z._-]{1,40}$/;   // the same as the table's check

  // The file's text -> { version, blocks: [{type: "h1"|"h2"|"p", text} | {type: "ul", items}] }. Pure.
  function parse(text) {
    const src = String(text || "").replace(/^﻿/, "").replace(/\r\n?/g, "\n");
    let body = src, version = null;
    const head = /^---\n([\s\S]*?)\n---\n/.exec(src);
    if (head) {
      body = src.slice(head[0].length);
      const v = /^version:\s*(\S+)\s*$/m.exec(head[1])?.[1] || null;
      version = v && VERSION.test(v) ? v : null;
    }
    const blocks = [];
    let para = null, list = null;
    for (const raw of body.split("\n")) {
      const line = raw.trim();
      if (!line) { para = list = null; continue; }
      const h = /^(#{1,2})\s+(.+)$/.exec(line), item = /^-\s+(.+)$/.exec(line);
      if (h) { blocks.push({ type: h[1].length === 1 ? "h1" : "h2", text: h[2] }); para = list = null; }
      else if (item) { para = null; if (!list) blocks.push(list = { type: "ul", items: [] }); list.items.push(item[1]); }
      else if (para) para.text += " " + line;
      else { list = null; blocks.push(para = { type: "p", text: line }); }
    }
    return { version, blocks };
  }

  // Whether this person has acknowledged this version: true, false, or null when it can't be told (never a reason to keep them out).
  async function acknowledged(sb, userId, version) {
    try {
      const { data, error } = await sb.from(TABLE).select("version").eq("user_id", userId).eq("version", version).limit(1);
      if (error || !Array.isArray(data)) return null;
      return data.length > 0;
    } catch { return null; }
  }
  // Records the acknowledgement; true when it is recorded (already there counts). The time is the database's own.
  async function record(sb, userId, version) {
    try {
      const { error } = await sb.from(TABLE).insert({ user_id: userId, version });
      return !error || error.code === "23505";
    } catch { return false; }
  }
  // Whether to ask: only when the note has a version and the record says plainly that this person has not acknowledged it.
  async function shouldAsk(sb, user, note) {
    if (!user?.id || !note?.version) return false;
    return (await acknowledged(sb, user.id, note.version)) === false;
  }

  // ---- in the browser ----------------------------------------------------------------------------------------------------
  let note = null, asking = false;
  function load() {
    note = note || root.fetch(FILE, { cache: "no-cache" }).then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status))))).then(parse)
      .catch(() => { note = null; return null; });   // a failed read is tried again next time
    return note;
  }

  function draw(n) {
    const FP = root.FP, box = FP.$("#privacy-note");
    if (!n?.blocks.length) { box.replaceChildren(FP.el("h1", {}, "Privacy and terms"), FP.el("p", {}, "The note couldn't be loaded just now. Check your connection and reload the page.")); return; }
    box.replaceChildren(...n.blocks.map((b) => (b.type === "ul" ? FP.el("ul", {}, ...b.items.map((t) => FP.el("li", {}, t))) : FP.el(b.type, {}, b.text))));
    FP.$("#privacy-version").textContent = n.version ? "Version " + n.version : "";
  }
  // Every "Privacy and terms" link, with the demo's address for it in the demo.
  function links() { for (const a of root.FP.$$("a.privacy-link")) a.setAttribute("href", root.FP.href(ROUTE)); }

  // The page: the note, Back (to the person's maps and files, or to sign in) and Print.
  async function open() {
    const FP = root.FP;
    FP.$("#privacy-ok").hidden = true; FP.$("#privacy-back").hidden = false; FP.$("#privacy-print").hidden = false; FP.$("#privacy-msg").textContent = "";
    FP.$("#privacy-back").setAttribute("href", FP.href("") || "#/");
    document.title = "Privacy and terms | " + (FP.brand?.product || "");
    FP.show("screen-privacy");
    draw(await load());
  }

  // After sign-in: resolves true once the person has said I understand, false when nothing was asked. Never rejects.
  async function gate(user) {
    const FP = root.FP;
    if (FP.demo?.active) return false;   // invented data and no sign-in: nothing to record
    const n = await load();
    if (!(await shouldAsk(FP.sb, user, n))) return false;
    asking = true;
    draw(n);
    FP.$("#privacy-ok").hidden = false; FP.$("#privacy-back").hidden = true; FP.$("#privacy-print").hidden = true; FP.$("#privacy-msg").textContent = "";
    document.title = "Privacy and terms | " + (FP.brand?.product || "");
    FP.show("screen-privacy");
    FP.$("#privacy-ok").focus({ preventScroll: true }); root.scrollTo?.(0, 0);   // the note is read from its top
    return new Promise((resolve) => {
      FP.$("#privacy-ok").onclick = async (ev) => {
        ev.target.disabled = true;
        await record(FP.sb, user.id, n.version);   // not recorded: they go on all the same, and are asked again next time
        ev.target.disabled = false; ev.target.onclick = null; asking = false;
        resolve(true);
      };
    });
  }

  if (typeof document !== "undefined") document.addEventListener("click", (e) => { if (e.target.closest?.("#privacy-print")) root.print(); });
  return { FILE, TABLE, ROUTE, parse, acknowledged, record, shouldAsk, load, open, gate, links, asking: () => asking, isRoute: (hash) => hash === ROUTE };
});
