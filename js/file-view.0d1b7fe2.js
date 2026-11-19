// FL2 (the owner, 16 Nov 2026: "Yes, keep the link out of sight"): a stored file opens inside the app, never at a signed storage address.
// The bytes are read with the person's own sign-in (Storage's download: the request carries the session, and its address alone opens
// nothing), so the same storage policy decides who may read which file as before; nothing is widened. They are shown from a blob:
// address, which lives only in this page and is released when the viewer closes.
//
//   FP.fileView.open({ sb, path, name, title?, size?, page?, opener?, stay? })   the viewer over the screen: a calm line while the file comes,
//                                                                          then the file (or Open and Share or save), Close
//   FP.fileView.fetch(sb, path, { signal }) -> Blob                        the bytes, as the signed-in person
//   FP.fileView.save(blob, name)                                           the bytes saved under the file's own name
//   FP.fileView.close()                                                    closes the viewer and releases what it held
//
// The pure part (kindOf, typeOf, loadingLine, failedLine, sizeText, signedAddress) has no DOM or network and is what the unit tests read.
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else { root.FP = root.FP || {}; root.FP.fileView = Object.assign(root.FP.fileView || {}, api); }
})(typeof window === "undefined" ? globalThis : window, function (root) {
  // ---- the pure part --------------------------------------------------------------------------------------------------------------
  // What a kind of file is shown as. A page or an SVG from storage is never framed as itself (it could script or navigate the app):
  // a page is shown as text in a frame that may run nothing; an SVG as a picture (a picture runs nothing).
  const TYPES = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
    txt: "text/plain", csv: "text/plain", html: "text/html", htm: "text/html" };
  const extOf = (path) => ((/\.([a-z0-9]{1,10})$/i.exec(String(path || "").split(/[?#]/)[0]) || [])[1] || "").toLowerCase();
  const typeOf = (path) => TYPES[extOf(path)] || null;
  function kindOf(path) {
    const t = typeOf(path);
    return !t ? "other" : t === "application/pdf" ? "pdf" : t.startsWith("image/") ? "image" : t === "text/html" ? "page" : "text";
  }
  const bytesOf = (v) => { const n = typeof v === "string" && v.trim() === "" ? NaN : Number(v); return Number.isFinite(n) && n > 0 ? n : null; };
  const sizeText = (n) => (n >= 1024 * 1024 ? Math.max(1, Math.round(n / 1024 / 1024)) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB");
  const BIG = 10 * 1024 * 1024;   // above this the line says a large file can take a while
  const loadingLine = (name, size) => {
    const n = bytesOf(size);
    return "Loading " + (name || "the file") + (n ? " (" + sizeText(n) + ")" : "") + "…" + (n && n > BIG ? " A large file can take a minute on a phone." : "");
  };
  const failedLine = (name, offline) => offline ? "You're offline. " + (name || "The file") + " opens when you're back in range."
    : "Couldn't open " + (name || "the file") + ". It may not be yours to read, or it is no longer held.";
  // The name a file is saved under: the name given, with the stored file's extension when the name lacks it
  const saveName = (name, path) => { const n = String(name || "file").trim() || "file", ext = extOf(path); return ext && extOf(n) !== ext ? n + "." + ext : n; };
  // A signed storage address: what must never reach the address bar, the history or the screen (the walk checks with the same test)
  const signedAddress = (s) => /token=|\/object\/sign\//.test(String(s || ""));

  const api = { TYPES, typeOf, kindOf, saveName, sizeText, loadingLine, failedLine, signedAddress, BIG };
  if (!root.document) return api;

  // ---- the browser's part ---------------------------------------------------------------------------------------------------------
  const FP = () => root.FP;
  const el = (...a) => FP().el(...a);
  const phone = () => !!root.matchMedia?.("(max-width: 800px)").matches;

  // (review of #613) cache: "no-store" on every read of a stored file: the read is a plain GET of the file's address with the sign-in in a
  // header, and a browser's HTTP cache keys on the address alone, so a copy kept for Storage's max-age could be handed to the next person
  // who signs in on this device without Storage asking whether they may read it. supabase-js's storage get spreads this third argument
  // into the fetch's options (vendor/supabase.js: qt("storage").get -> Kt -> Gt, which returns { method, headers, ...parameters } for a GET).
  async function fetchFile(sb, path, { signal } = {}) {
    if (!sb?.storage || !path) throw Error("no file");
    const { data, error } = await sb.storage.from("documents").download(path, {}, { cache: "no-store", ...(signal ? { signal } : {}) });
    if (error || !data) throw error || Error("no file");
    return data;
  }
  // the bytes saved under the file's own name, from a blob: address released straight after
  function save(blob, name) {
    const url = root.URL.createObjectURL(blob), a = el("a", { href: url, download: name || "file", hidden: true });
    root.document.body.append(a); a.click(); a.remove();
    setTimeout(() => root.URL.revokeObjectURL(url), 4000);
  }

  let current = null;   // { node, close }
  function close() { current?.close(); }

  function open({ sb, path, name, title = null, size = null, page = null, opener = null, stay = null } = {}) {
    close();
    const R = FP().formRows, kind = kindOf(path), shown = title || name || "File";
    const ctl = root.AbortController ? new root.AbortController() : null;
    let url = null, gone = false;
    const stilled = [];   // UX1: the parts of the page made inert while the viewer is open
    const end = el("span", { class: "fv-acts" });
    const s = R.sheet({ id: "file-view", title: shown, titleId: "file-view-title", cancelLabel: "Close", cancelId: "file-view-close", onSave: false, className: "file-view", extra: end,
      onCancel: () => shut() });
    const node = s.node, body = s.body;
    body.classList.add("fv-body");
    const line = el("p", { class: "fv-line", role: "status", id: "file-view-line" }, loadingLine(name || shown, size));
    body.append(line);
    function shut(refocus = true) {
      if (gone) return;
      gone = true;
      try { ctl?.abort(); } catch { /* already done */ }
      if (FP().sheet?.isOpen?.()) FP().sheet.close(false);
      body.replaceChildren();   // the frame or picture leaves before its address is released
      s.close();
      if (url) { try { root.URL.revokeObjectURL(url); } catch { /* gone */ } url = null; }
      root.document.body.classList.remove("fv-open");
      for (const n of stilled) n.inert = false;   // UX1: the page behind is the person's again (before the focus goes back to it)
      stilled.length = 0;
      root.removeEventListener("hashchange", onHash);
      root.document.removeEventListener("focusin", onFocus);
      if (current?.node === node) current = null;
      if (refocus && opener?.isConnected) opener.focus();
    }
    // leaving the screen closes it; a host that moved its own address to this file as it opened it (stay) keeps it open for that move
    let keep = stay ? new root.URL(stay, root.location.href).hash : null;
    const onHash = () => { if (keep && root.location.hash === keep) { keep = null; return; } shut(false); };
    root.addEventListener("hashchange", onHash);
    // the focus stays in the viewer while it is open (the screen under it may redraw and focus a row of its own); Share or save's sheet
    // over it is part of it
    const onFocus = (e) => { if (!gone && !node.contains(e.target) && !e.target?.closest?.(".add-sheet")) s.cancel.focus(); };
    root.document.addEventListener("focusin", onFocus);
    // UX1: a click on the dimmed backdrop keeps the focus where it is, and a click on a part of the viewer that takes no focus puts it
    // back on Close rather than leaving it on the page behind (the file's own frame, or another window, keeping the focus is left alone)
    node.addEventListener("mousedown", (e) => { if (e.target === node) e.preventDefault(); });
    node.addEventListener("focusout", (e) => {
      if (e.relatedTarget) return;
      root.setTimeout(() => { const a = root.document.activeElement; if (!gone && root.document.hasFocus() && (!a || a === root.document.body)) s.cancel.focus(); }, 0);
    });
    current = { node, close: () => shut() };
    root.document.body.append(node);
    root.document.body.classList.add("fv-open");
    // UX1: everything else on the page (the place's header and its sections included) is still while the viewer is open: it cannot be
    // clicked, tapped or reached with Tab; Share or save's sheet and a "Saved" line, which come over the viewer, are left as they are
    for (const n of root.document.body.children) if (n !== node && !n.inert && !n.matches("script, style, .add-sheet, .toast")) { n.inert = true; stilled.push(n); }
    s.mounted();
    s.cancel.focus();

    fetchFile(sb, path, { signal: ctl?.signal }).then((blob) => {
      if (gone) return;
      // a kind the viewer does not know is bytes, whatever type Storage holds for it (that type came from whoever uploaded the file)
      const type = typeOf(path) || "application/octet-stream";
      const file = new root.Blob([blob], { type });
      url = root.URL.createObjectURL(file);
      const at = url + (kind === "pdf" && Number.isInteger(page) && page > 0 ? "#page=" + page : "");
      const fileName = saveName(name || shown, path);
      // Share or save: the file itself, to the phone's share sheet or saved; never a link
      if (FP().shareSave?.button) end.append(FP().shareSave.button(() => ({ what: fileName, files: [{ key: "file", label: "Save the file", hint: fileName, name: fileName, type, share: "file", make: () => file }] })));
      const openIt = (filled) => el("a", { class: "fv-open" + (filled ? " fv-primary" : ""), id: "file-view-open", href: at, target: "_blank", rel: "noopener", title: filled ? "Open in this phone's own viewer" : "Open in a new tab" }, "Open");
      const parts = [];
      if (kind === "image") parts.push(el("img", { class: "fv-img", id: "file-view-file", src: url, alt: shown }));
      else if (kind === "page") {
        // a page from storage, shown in a frame that may run nothing and go nowhere
        parts.push(el("iframe", { class: "fv-frame", id: "file-view-file", sandbox: "", title: shown }));
        file.text().then((t) => { if (!gone) parts[0].srcdoc = t; }).catch(() => {});
      } else if (kind === "text" || (kind === "pdf" && !phone())) parts.push(el("iframe", { class: "fv-frame", id: "file-view-file", src: at, title: shown }));
      else parts.push(el("div", { class: "fv-card", id: "file-view-file" },
        el("p", { class: "fv-name" }, fileName, el("small", {}, sizeText(file.size))),
        el("p", { class: "fv-quiet" }, kind === "pdf" ? "Open it in this phone's own viewer, or share or save it." : "This kind of file can't be shown here. Save it, or share it to an app that opens it."),
        kind === "pdf" ? openIt(true) : el("button", { type: "button", class: "fv-open fv-primary", id: "file-view-save", onclick: () => save(file, fileName) }, "Save")));
      line.textContent = ""; line.hidden = true;
      body.append(...parts);
      // (never a stored page or SVG at a top-level address of the app's own origin, where it could script or navigate: those are viewed here only)
      if ((kind === "pdf" && !phone()) || kind === "text" || (kind === "image" && type !== "image/svg+xml")) end.prepend(openIt(false));
    }).catch(() => {
      if (gone) return;
      line.textContent = failedLine(name || shown, root.navigator?.onLine === false);
      line.setAttribute("role", "alert");
      line.classList.add("fv-failed");
    });
    return current;
  }

  return Object.assign(api, { open, close, fetch: fetchFile, save, isOpen: () => !!current });
});
