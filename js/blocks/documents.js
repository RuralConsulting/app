// Documents block: a farm's (or group's) documents as a specialist would hand them over. The main documents first,
// by kind (the plan, then consents and decisions, then budgets, the map, other reports) and then newest first; each
// with its supporting documents folded underneath (relates_to, read through document_relations); supporting ones
// that sit under nothing in one quiet fold; the archive only through search. One plain source line per document;
// a title opens the original through a signed URL (the host's [data-open-document] handler).
// Editors also get the upload drop-zone (tap to choose on a phone), a one-step confirm of the classifier's guess
// (classify.js), and a one-tap change of where a document sits. Row-level security decides what is allowed.
// Data: { documents: [documents rows + relates_to], canEdit?, canAdd?, notice?, title? }. render is pure; mounted
// wires search, upload and moves to ctx.store ({ add(item) -> id, move(id, change), changed() }) when the host has one.
(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const api = factory(node ? require("./registry.js") : root.FP.blocks, node ? require("../farm-model.js") : root.FP.farmModel,
    node ? require("../classify.js") : root.FP.classify);
  if (node) module.exports = api; else root.FP.documentsBlock = api;
})(typeof window === "undefined" ? globalThis : window, function (blocks, M, C) {
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const list = (v) => Array.isArray(v) ? v : [];
  const text = (v) => typeof v === "string" && v.trim();
  const day = (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null;
  // Newest by the date it was prepared; undated ones after the dated, newest added first; then by title, so nothing jumps.
  const newest = (a, b) => (!day(a.date_prepared) - !day(b.date_prepared)) || String(day(b.date_prepared) || "").localeCompare(String(day(a.date_prepared) || "")) ||
    String(day(b.created_at) || "").localeCompare(String(day(a.created_at) || "")) || String(a.title || "").localeCompare(String(b.title || "")) || String(a.id).localeCompare(String(b.id));
  const plural = (n, one, many) => n + " " + (n === 1 ? one : many);
  const MAX_RESULTS = 30, MAX_BYTES = 100 * 1024 * 1024;   // the bucket's own limit (storage migration)

  // ---- what goes where (pure) ---------------------------------------------------------------------------------
  // { primaries: [{ doc, tier, children }], more: [...], loose: [...], archive: [...], all: [...] } in display order.
  function arrange(docs, o = {}) {
    const kinds = list(o.kinds).map((k) => k.toLowerCase());
    const rows = list(docs).filter((d) => d && d.id != null && (!kinds.length || kinds.includes(String(d.doc_type || "").toLowerCase())));
    const ids = new Set(rows.map((d) => d.id)), parents = new Set(rows.map((d) => d.relates_to).filter((p) => ids.has(p)));
    // whether the farm has a plan decides where a digitising record sits (with it, supporting; without, it may be the map)
    const plan = list(docs).some((d) => d && M.isPlan(d));
    const placed = rows.map((doc) => ({ doc, tier: M.docTier(doc, parents.has(doc.id), plan) }));
    const primary = placed.filter((p) => p.tier.tier === "primary"), primaryIds = new Set(primary.map((p) => p.doc.id));
    const under = new Map(primary.map((p) => [p.doc.id, []])), loose = [], archive = [];
    for (const p of placed) {
      if (p.tier.tier === "archive") archive.push(p);
      else if (p.tier.tier === "supporting") (primaryIds.has(p.doc.relates_to) ? under.get(p.doc.relates_to) : loose).push(p);
    }
    const byDate = (a, b) => newest(a.doc, b.doc);
    primary.sort((a, b) => a.tier.weight - b.tier.weight || byDate(a, b));
    const primaries = primary.map((p) => ({ ...p, children: under.get(p.doc.id).sort(byDate) }));
    const shown = o.limit ? primaries.slice(0, o.limit) : primaries;
    return { primaries: shown, more: primaries.slice(shown.length), loose: loose.sort(byDate), archive: archive.sort(byDate), all: placed };
  }

  // The one plain line under a title: what it is (when the title doesn't say, or when nothing else would), who prepared
  // it, when (the date prepared, else the end of the period it covers).
  function sourceLine(d) {
    const kind = M.docKind(d.doc_type), title = String(M.docTitle(d)).toLowerCase();
    const who = d.author_org || d.author, when = day(d.date_prepared) || day(d.period_end);
    const parts = [kind && kind !== "Other" && (!title.includes(kind.toLowerCase()) || (!who && !when)) ? kind : null, who || null, when ? M.date(when) : null];
    if (!who && !when && day(d.created_at)) parts.push("added " + M.date(day(d.created_at)));
    return parts.filter(Boolean).join(" · ") || "Nothing more recorded";
  }
  // Runs of one kind folded to one line ("6 S-map soil fact sheets"), where the first of them stands.
  function runs(items) {
    const n = new Map();
    for (const p of items) if (p.tier.fold) n.set(p.tier.fold, (n.get(p.tier.fold) || 0) + 1);
    const out = [];
    for (const p of items) {
      if (p.tier.fold && n.get(p.tier.fold) > 1) { if (!out.some((s) => s.fold === p.tier.fold)) out.push({ fold: p.tier.fold, items: items.filter((x) => x.tier.fold === p.tier.fold) }); }
      else if (out.length && !out[out.length - 1].fold) out[out.length - 1].items.push(p);
      else out.push({ items: [p] });
    }
    return out;
  }
  // What a fold holds, in a few words: "notes, a map extract and 3 S-map soil fact sheets".
  function kindsLine(items) {
    const counts = new Map();
    // a word's capital goes; "FEP", "NZFAP+" and "S-map" keep theirs
    for (const p of items) { const k = (M.docKind(p.doc.doc_type) || "Document").replace(/\b[A-Z](?=[a-z])/g, (c) => c.toLowerCase()); counts.set(k, (counts.get(k) || 0) + 1); }
    const words = [...counts].map(([k, c]) => (c > 1 ? k + " (" + c + ")" : k));
    return words.length > 3 ? words.slice(0, 3).join(", ") + " and more" : words.length > 1 ? words.slice(0, -1).join(", ") + " and " + words[words.length - 1] : words[0] || "";
  }

  // ---- markup (pure) -------------------------------------------------------------------------------------------
  function rowHtml(p, o, data, note) {
    const d = p.doc, title = M.docTitle(d), mine = o.selected != null && String(o.selected) === String(d.id);
    const name = d.storage_path ? '<button type="button" class="doc-open" data-open-document="' + esc(d.id) + '">' + esc(title) + "</button>" : "<span>" + esc(title) + "</span>";
    const move = data.canEdit ? '<button type="button" class="doc-move" data-doc-move="' + esc(d.id) + '" aria-expanded="false" aria-label="Change where ' + esc(title) + ' sits"><span aria-hidden="true">•••</span></button>' : "";
    return '<li class="doc' + (mine ? " selected-record" : "") + '" data-item-id="' + esc(d.id) + '" data-doc-tier="' + esc(p.tier.tier) + '" tabindex="-1">' +
      '<div class="doc-head"><p class="doc-title">' + name + "</p>" + move + "</div>" +
      '<p class="doc-source">' + esc((note ? note + " · " : "") + sourceLine(d)) + "</p>";
  }
  const holds = (items, o) => o.selected != null && items.some((p) => String(p.doc.id) === String(o.selected));
  function foldHtml(items, o, data, label, cls) {
    if (!items.length) return "";
    const body = runs(items).map((s) => s.fold
      ? '<li class="doc-run"><details' + (holds(s.items, o) ? " open" : "") + "><summary>" + esc(s.items.length + " " + s.fold) + '</summary><ul class="doc-list">' + s.items.map((p) => rowHtml(p, o, data) + "</li>").join("") + "</ul></details></li>"
      : s.items.map((p) => rowHtml(p, o, data) + "</li>").join("")).join("");
    return '<details class="doc-fold' + (cls ? " " + cls : "") + '"' + (holds(items, o) ? " open" : "") + "><summary><span>" + esc(label) + "</span>" +
      (kindsLine(items) ? "<small>" + esc(kindsLine(items)) + "</small>" : "") + '</summary><ul class="doc-list doc-sub">' + body + "</ul></details>";
  }
  function primaryHtml(p, o, data) {
    const n = p.children.length;
    return rowHtml(p, o, data) + foldHtml(p.children, o, data, plural(n, "supporting document", "supporting documents")) + "</li>";
  }
  // The search field's label is shown (a placeholder is not a label); the placeholder gives an example instead.
  const searchHtml = (value = "", results = "") => '<div class="doc-search"><label><span class="doc-search-label">Search documents</span>' +
    '<input type="search" data-doc-search autocomplete="off" spellcheck="false" placeholder="e.g. S-map, consent, 2024" value="' + esc(value) + '"></label>' +
    '<div class="doc-results" aria-live="polite">' + results + "</div></div>";
  const addHtml = () => '<div class="doc-add"><label class="doc-drop"><input type="file" multiple data-doc-file class="visually-hidden"><span>Add documents</span></label>' +
    '<div class="doc-confirm" hidden></div></div>';

  // Search across every tier, archive included: every word must match the title, kind, author or file name. Spaces,
  // hyphens, dots, underscores and the like are not read ("smap" finds "S-map", "eyre 3a1" finds "Eyre_3a.1"); the
  // whole query run together counts too ("s map").
  const squash = (v) => String(v || "").toLowerCase().replace(/[\s\-\u2010-\u2015_.,:;'\u2018\u2019"\u201c\u201d/\\()[\]]+/g, "");
  function search(docs, q) {
    const words = String(q || "").toLowerCase().split(/\s+/).map(squash).filter(Boolean), whole = squash(q);
    if (!words.length) return [];
    return arrange(docs).all.filter(({ doc: d }) => {
      const hay = squash([M.docTitle(d), d.title, M.docKind(d.doc_type), d.author, d.author_org, d.original_name].filter(Boolean).join(" "));
      return words.every((w) => hay.includes(w)) || hay.includes(whole);
    }).sort((a, b) => (a.tier.tier === "archive") - (b.tier.tier === "archive") || newest(a.doc, b.doc));
  }
  function resultsHtml(data, o, q) {
    if (!text(q)) return "";
    const docs = list(data?.documents), byId = new Map(docs.map((d) => [d.id, d])), found = search(docs, q);
    if (!found.length) return '<p class="doc-none">Nothing matches “' + esc(q.trim()) + "”.</p>";
    const note = (p) => p.tier.tier === "archive" ? "Archived" : p.tier.tier === "supporting" && byId.get(p.doc.relates_to) ? "With " + M.docTitle(byId.get(p.doc.relates_to)) : null;
    return '<ul class="doc-list">' + found.slice(0, MAX_RESULTS).map((p) => rowHtml(p, o, data, note(p)) + "</li>").join("") + "</ul>" +
      (found.length > MAX_RESULTS ? '<p class="doc-none">' + found.length + " match; the first " + MAX_RESULTS + " are shown.</p>" : "");
  }

  function state(data) {
    const n = list(data?.documents).length;
    return n === 0 ? "empty" : n < 3 ? "sparse" : "full";
  }
  function render(data, o, ctx) {
    const d = data || {}, docs = list(d.documents), h = ctx.level;
    const title = text(d.title) || "Documents";
    if (!docs.length && !d.canAdd) return "";
    const a = arrange(docs, o);
    const heading = "<h" + h + ' class="block-title' + (ctx.nested ? " visually-hidden" : "") + '">' + esc(title) + "</h" + h + ">";
    const main = a.primaries.length ? '<ul class="doc-list doc-main">' + a.primaries.map((p) => primaryHtml(p, o, d)).join("") + "</ul>" : "";
    const more = a.more.length ? '<details class="doc-fold doc-more"' + (holds(a.more.concat(a.more.flatMap((p) => p.children)), o) ? " open" : "") + "><summary><span>" +
      esc(plural(a.more.length, "more main document", "more main documents")) + '</span></summary><ul class="doc-list">' + a.more.map((p) => primaryHtml(p, o, d)).join("") + "</ul></details>" : "";
    const loose = foldHtml(a.loose, o, d, a.primaries.length ? plural(a.loose.length, "other supporting document", "other supporting documents") : plural(a.loose.length, "supporting document", "supporting documents"), "doc-loose");
    const archived = o.show_archive ? foldHtml(a.archive, o, d, plural(a.archive.length, "archived document", "archived documents"), "doc-archive") : "";
    // The archive is found by search. A route that names an archived document opens with it found.
    const picked = !o.show_archive && o.selected != null ? a.archive.find((p) => String(p.doc.id) === String(o.selected)) : null;
    const searchable = docs.length > 6 || a.archive.length > 0;
    const notice = text(d.notice) ? '<p class="doc-notice" role="status">' + esc(d.notice) + "</p>" : "";
    const none = !docs.length ? (ctx.nested ? "" : '<p class="doc-none">No documents yet.</p>') : !a.primaries.length && !a.loose.length && !archived ? '<p class="doc-none">' +
      (o.kinds.length ? "None of these kinds is recorded." : "Every document here is archived; search to find one.") + "</p>" : "";
    return '<section class="documents-block" data-documents="' + docs.length + '">' + heading + notice + none + main + more + loose + archived +
      (searchable ? searchHtml(picked ? M.docTitle(picked.doc) : "", picked ? resultsHtml(d, o, M.docTitle(picked.doc)) : "") : "") +
      (d.canAdd ? addHtml() : "") + "</section>";
  }

  // ---- upload and move: the confirm step and the tier menu (pure markup, wired in mounted) --------------------
  const size = (n) => (n >= 1048576 ? (n / 1048576).toFixed(n >= 10485760 ? 0 : 1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB");
  // One guess per file, in order: a file can sit under a main document chosen earlier in the same batch (key "new:<n>"),
  // so a plan's PDF and its workbook dropped together are one main document and its other format.
  function guessBatch(files, primaries) {
    const mains = list(primaries).map((p) => ({ id: p.id, title: M.docTitle(p), doc_type: p.doc_type, original_name: p.original_name, date_prepared: p.date_prepared }));
    return list(files).map((file, i) => {
      const guess = C.rules(file, mains), key = "new:" + i;
      if (guess.tier === "primary") mains.push({ id: key, title: guess.title, doc_type: guess.doc_type, original_name: file.name });
      return { key, file, name: file.name, bytes: file.size, guess, tooBig: file.size > MAX_BYTES };
    });
  }
  function confirmHtml(items, primaries) {
    const mains = list(primaries).map((p) => [String(p.id), M.docTitle(p)]);
    const fields = items.map((it, i) => {
      const g = it.guess, here = [...mains, ...items.slice(0, i).filter((x) => x.guess.tier === "primary").map((x) => [x.key, x.guess.title])];
      const radio = (t, label) => '<label><input type="radio" name="tier-' + i + '" value="' + t + '"' + (g.tier === t ? " checked" : "") + "> " + label + "</label>";
      return '<fieldset class="doc-item" data-doc-item="' + i + '"' + (it.tooBig ? " disabled" : "") + "><legend>" + esc(it.name) + " · " + esc(size(it.bytes)) + "</legend>" +
        (it.tooBig ? '<p class="doc-none">Too large to add here (over 100 MB).</p>' :
        '<label class="doc-field"><span>Title</span><input name="title-' + i + '" value="' + esc(g.title) + '" required></label>' +
        '<label class="doc-field"><span>Kind</span><select name="kind-' + i + '">' + C.KINDS.map(([k, label]) => '<option value="' + k + '"' + (k === g.doc_type ? " selected" : "") + ">" + esc(label) + "</option>").join("") + "</select></label>" +
        '<div class="doc-tiers" role="radiogroup" aria-label="Where it sits">' + radio("primary", "Main") + radio("supporting", "Supporting") + radio("archive", "Archive") + "</div>" +
        '<label class="doc-field doc-under"' + (g.tier === "supporting" ? "" : " hidden") + '><span>With</span><select name="under-' + i + '"><option value="">No main document</option>' +
          here.map(([id, t]) => '<option value="' + esc(id) + '"' + (id === g.relates_to ? " selected" : "") + ">" + esc(t) + "</option>").join("") + "</select></label>") + "</fieldset>";
    }).join("");
    const n = items.filter((it) => !it.tooBig).length;
    return '<form class="doc-confirm-form" novalidate>' + fields + '<p class="doc-msg" role="status" aria-live="polite"></p><div class="doc-actions">' +
      (n ? '<button type="submit">' + (n === 1 ? "Add document" : "Add " + n + " documents") + "</button>" : "") + '<button type="button" class="link" data-doc-cancel>Cancel</button></div></form>';
  }
  // Read the confirmed choices back out of the form: one { key, file, title, doc_type, tier, relates_to } per file.
  function confirmed(items, value) {
    return items.map((it, i) => it.tooBig ? null : (() => {
      const tier = value("tier-" + i) || it.guess.tier, under = tier === "supporting" ? value("under-" + i) || null : null;
      return { key: it.key, file: it.file, title: String(value("title-" + i) || it.guess.title).trim() || it.guess.title, doc_type: value("kind-" + i) || it.guess.doc_type, tier, relates_to: under };
    })()).filter(Boolean);
  }
  // Primaries first, so a file can sit under a main document added in the same batch.
  const saveOrder = (choices) => [...choices].sort((a, b) => (a.tier !== "primary") - (b.tier !== "primary"));
  function moveHtml(doc, data) {
    const docs = list(data?.documents), a = arrange(docs), here = M.docTier(doc, docs.some((x) => x.relates_to === doc.id)).tier;
    const others = [...a.primaries, ...a.more].filter((p) => p.doc.id !== doc.id);
    const opt = (attrs, label, current) => '<li><button type="button" ' + attrs + (current ? ' aria-current="true"' : "") + ">" + esc(label) + "</button></li>";
    return '<ul class="doc-menu" data-doc-menu="' + esc(doc.id) + '">' + opt('data-doc-set="primary"', "Main document", here === "primary") +
      others.map((p) => opt('data-doc-set="supporting" data-doc-under="' + esc(p.doc.id) + '"', "With " + M.docTitle(p.doc), here === "supporting" && doc.relates_to === p.doc.id)).join("") +
      opt('data-doc-set="archive"', "Archive", here === "archive") + "</ul>";
  }
  // The update a menu choice sends: a primary or an archived document sits under nothing (F1e's constraint).
  const change = (tier, under) => ({ tier, relates_to: tier === "supporting" ? under || null : null });

  // The content address the loader uses (tools/load_documents.py) and the database insists on: <farm>/<sha256><.ext>.
  const storagePath = (owner, sha, name) => String(owner) + "/" + sha + C.extension(name);
  async function sha256Hex(bytes) {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  // ---- the live part (browser) -------------------------------------------------------------------------------
  function mounted(host, data, o, ctx) {
    const rootEl = host.querySelector(".documents-block");
    if (!rootEl) return null;
    const store = ctx.store || null, d = data || {};
    const primaries = () => { const a = arrange(list(d.documents)); return [...a.primaries, ...a.more].map((p) => p.doc); };
    const input = rootEl.querySelector("[data-doc-search]"), results = rootEl.querySelector(".doc-results");
    input?.addEventListener("input", () => { results.innerHTML = resultsHtml(d, o, input.value); });
    let items = [];
    const box = rootEl.querySelector(".doc-confirm"), drop = rootEl.querySelector(".doc-drop");
    function choose(files) {
      if (!box || !files.length) return;
      items = guessBatch([...files], primaries());
      box.innerHTML = confirmHtml(items, primaries()); box.hidden = false; drop.hidden = true;
      box.querySelector("input[name^=title-]")?.focus();
    }
    function closeConfirm() { if (!box) return; items = []; box.innerHTML = ""; box.hidden = true; drop.hidden = false; }
    rootEl.querySelector("[data-doc-file]")?.addEventListener("change", (e) => { choose(e.target.files || []); e.target.value = ""; });
    if (drop) {
      for (const t of ["dragenter", "dragover"]) rootEl.addEventListener(t, (e) => { if (!e.dataTransfer?.types?.includes("Files")) return; e.preventDefault(); drop.classList.add("doc-drop-over"); });
      rootEl.addEventListener("dragleave", (e) => { if (!rootEl.contains(e.relatedTarget)) drop.classList.remove("doc-drop-over"); });
      rootEl.addEventListener("drop", (e) => { if (!e.dataTransfer?.files?.length) return; e.preventDefault(); drop.classList.remove("doc-drop-over"); choose(e.dataTransfer.files); });
    }
    rootEl.addEventListener("change", (e) => {
      const radio = e.target.closest?.('.doc-tiers input[type="radio"]');
      if (radio) radio.closest("fieldset").querySelector(".doc-under").hidden = radio.value !== "supporting";
    });
    rootEl.addEventListener("submit", async (e) => {
      if (!e.target.matches(".doc-confirm-form")) return;
      e.preventDefault();
      const form = e.target, msg = form.querySelector(".doc-msg"), button = form.querySelector('button[type="submit"]');
      const value = (name) => form.elements.namedItem(name)?.value ?? null;   // a radio group reads as its checked value
      const choices = saveOrder(confirmed(items, value));
      if (!store) { msg.textContent = "Not added: nothing here saves documents."; return; }
      button.disabled = true; msg.textContent = choices.length === 1 ? "Adding…" : "Adding " + choices.length + " documents…";
      const ids = new Map(), failed = [];
      for (const c of choices) {
        if (ctx.stale()) return;
        try { ids.set(c.key, await store.add({ ...c, relates_to: c.relates_to && c.relates_to.startsWith("new:") ? ids.get(c.relates_to) || null : c.relates_to })); }
        catch (err) { failed.push(c.title + ": " + (err?.message || err)); }
      }
      if (ctx.stale()) return;
      const added = choices.length - failed.length;
      if (!failed.length) { await store.changed(added === 1 ? "Added " + choices[0].title + "." : "Added " + added + " documents."); return; }
      button.disabled = false;
      msg.textContent = (added ? "Added " + added + ". " : "") + "Not added: " + failed.join("; ");
      if (added) await store.changed(msg.textContent);
    });
    rootEl.addEventListener("click", async (e) => {
      if (e.target.closest("[data-doc-cancel]")) { closeConfirm(); return; }
      const toggle = e.target.closest("[data-doc-move]");
      if (toggle) {
        const open = rootEl.querySelector('[data-doc-menu="' + CSS.escape(toggle.dataset.docMove) + '"]');
        for (const m of rootEl.querySelectorAll(".doc-menu")) m.remove();
        for (const b of rootEl.querySelectorAll("[data-doc-move]")) b.setAttribute("aria-expanded", "false");
        if (open) return;
        const doc = list(d.documents).find((x) => String(x.id) === toggle.dataset.docMove);
        toggle.closest(".doc").querySelector(".doc-head").insertAdjacentHTML("afterend", moveHtml(doc, d));
        toggle.setAttribute("aria-expanded", "true");
        return;
      }
      const set = e.target.closest("[data-doc-set]");
      if (!set) return;
      const menu = set.closest(".doc-menu"), id = menu.dataset.docMenu;
      if (!store) { menu.insertAdjacentHTML("afterend", '<p class="doc-msg" role="status">Not changed: nothing here saves documents.</p>'); menu.remove(); return; }
      for (const b of menu.querySelectorAll("button")) b.disabled = true;
      try { await store.move(id, change(set.dataset.docSet, set.dataset.docUnder)); if (!ctx.stale()) await store.changed(null); }
      catch (err) {
        if (ctx.stale()) return;
        menu.insertAdjacentHTML("afterend", '<p class="doc-msg" role="status">' + esc(err?.message || "That change wasn't allowed.") + "</p>"); menu.remove();
      }
    });
    return { primaries };
  }

  const block = blocks.define({
    id: "documents", title: "Documents", empty: "No documents recorded yet.",
    options: {
      show_archive: { type: "boolean", default: false },   // archived documents as their own folded line, as well as by search
      kinds: { type: "list", default: [] },                // only these document types (doc_type names); none = every kind
      limit: { type: "integer", default: null, min: 1, max: 200 },   // main documents shown before "n more"
      selected: { type: "string", default: null },         // the document to open and mark (a route's ?item=)
    },
    state, render, mounted,
  });
  return { block, arrange, sourceLine, search, resultsHtml, guessBatch, confirmHtml, confirmed, saveOrder, moveHtml, change, storagePath, sha256Hex, state, MAX_BYTES };
});
