// Documents block: a farm's (or group's) documents as a specialist would hand them over. The main documents first,
// by kind (the plan, then consents and decisions, then budgets, the map, other reports) and then newest first; each
// with its supporting documents folded underneath (relates_to, read through document_relations); supporting ones
// that sit under nothing in one quiet fold; the archive only through search. One plain source line per document;
// a title opens the original through a signed URL (the host's [data-open-document] handler).
// Editors also get the upload drop-zone (tap to choose on a phone), a one-step confirm of the classifier's guess
// (classify.js), and a one-tap change of where a document sits. Row-level security decides what is allowed.
// B3DZ: a Farm Environment Plan dropped here (by name, or by the sheets of an FEP workbook the plan reader knows) is
// guessed as the farm's main plan through the same confirm step and the same insert; once added, a plain line offers
// "Read this plan in".
// FU4: that line is a button. It asks the store for requestReadIn (one row in public.plan_import_requests, once per plan), and the
// line then says "requested by you, <date>" and links to the Onboarding checklist, where the plan stands as "An advisor reads this
// plan in" with who asked and when (ON1; PL11's confirm reads it in and marks the request). Nothing is imported from here.
// Data: { documents: [documents rows + relates_to], canEdit?, canAdd?, notice?, offer?: [{ id, title }], readInHref?, requests?: [open
// plan_import_requests rows], userId?, title?, place? (the farm's or group's name, for an empty explorer's one sentence: RF1) }. render is pure; mounted wires search, upload and moves to ctx.store
// ({ add(item) -> id, move(id, change), changed(), requestReadIn(id), supersede(id, by), download(doc) -> { url, name } }) when the host has one.
// V5 (files that work): each file says its type and issue date, and "Superseded" where it is; a superseded file stays readable, in its
// own fold (status superseded, tier not archive); the Download button saves a file under its original name (downloadName); data.canSupersede
// (RCL staff who can edit) offers "Superseded by ..." in the move menu, and the database enforces it (guard_document_supersession).
// The block calls nothing itself: the host's store does (app/js/document-files.js holds the reads and writes both hosts use).
// PH3: with option explorer (both Files screens) the same rows are drawn as a file explorer: folders from each file's kind, then a
// folder's files with the way up and one sort; the actions above are unchanged and reached the same way (data-* attributes).
(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const api = factory(node ? require("./registry.js") : root.FP.blocks, node ? require("../farm-model.js") : root.FP.farmModel,
    node ? require("../classify.js") : root.FP.classify, node ? require("../icons.js") : root.FP.icons);
  if (node) module.exports = api; else root.FP.documentsBlock = api;
})(typeof window === "undefined" ? globalThis : window, function (blocks, M, C, I) {
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const list = (v) => Array.isArray(v) ? v : [];
  const text = (v) => typeof v === "string" && v.trim();
  const day = (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null;
  // Newest by the date it was prepared; undated ones after the dated, newest added first; then by title, so nothing jumps.
  const newest = (a, b) => (!day(a.date_prepared) - !day(b.date_prepared)) || String(day(b.date_prepared) || "").localeCompare(String(day(a.date_prepared) || "")) ||
    String(day(b.created_at) || "").localeCompare(String(day(a.created_at) || "")) || String(a.title || "").localeCompare(String(b.title || "")) || String(a.id).localeCompare(String(b.id));
  const plural = (n, one, many) => n + " " + (n === 1 ? one : many);
  const MAX_RESULTS = 30, MAX_BYTES = 100 * 1024 * 1024;   // the bucket's own limit (storage migration)
  const isSuperseded = (d) => String(d?.status || "").toLowerCase() === "superseded";
  // Where a document is shown. A superseded file a person can still use (its tier is not archive) has its own place; a row from before
  // tiers goes by docTier (archived).
  function placeOf(doc, hasChildren, planExists) {
    const t = M.docTier(doc, hasChildren, planExists);
    return isSuperseded(doc) && ["primary", "supporting"].includes(String(doc.tier || "").toLowerCase()) ? { ...t, tier: "superseded" } : t;
  }

  // ---- what goes where (pure) ---------------------------------------------------------------------------------
  // { primaries: [{ doc, tier, children }], more: [...], loose: [...], superseded: [...], archive: [...], all: [...] } in display order.
  function arrange(docs, o = {}) {
    const kinds = list(o.kinds).map((k) => k.toLowerCase());
    const rows = list(docs).filter((d) => d && d.id != null && (!kinds.length || kinds.includes(String(d.doc_type || "").toLowerCase())));
    const ids = new Set(rows.map((d) => d.id)), parents = new Set(rows.map((d) => d.relates_to).filter((p) => ids.has(p)));
    // whether the farm has a plan decides where a digitising record sits (with it, supporting; without, it may be the map)
    const plan = list(docs).some((d) => d && M.isPlan(d));
    const placed = rows.map((doc) => ({ doc, tier: placeOf(doc, parents.has(doc.id), plan) }));
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
    const superseded = placed.filter((p) => p.tier.tier === "superseded").sort(byDate);
    return { primaries: shown, more: primaries.slice(shown.length), loose: loose.sort(byDate), superseded, archive: archive.sort(byDate), all: placed };
  }

  // The one plain line under a title: what it is (when the title doesn't say, or when nothing else would), who prepared
  // it, when (the date prepared, else the end of the period it covers).
  function sourceLine(d) {
    // An issued plan (PL14, tools/issue_plan.cjs): when it was issued and the version of the document it was issued in.
    if (String(d.doc_type || "").toLowerCase() === "plan_issue") {
      const when = day(d.date_prepared) || day(d.created_at), version = /^\d+$/.test(String(d.model_version ?? "")) ? "version " + d.model_version : null;
      return ["Issued " + (when ? M.date(when) : "on a date not recorded"), version, d.author_org || null].filter(Boolean).join(" · ");
    }
    // An onboarding report (ON1): when it was saved; it opens in the checklist view.
    if (String(d.doc_type || "").toLowerCase() === "onboarding_report")
      return ["Onboarding report", day(d.created_at) ? "saved " + M.date(day(d.created_at)) : null, "opens as a checklist"].filter(Boolean).join(" · ");
    // V5: every file says what it is and when it was issued. No date prepared: the end of the period it covers, else when it was added, each said as that.
    const kind = M.docKind(d.doc_type), who = d.author_org || d.author, issued = day(d.date_prepared), period = day(d.period_end), added = day(d.created_at);
    return [!kind || kind === "Other" ? "Other file" : kind, who || null,
      issued ? "Issued " + M.date(issued) : period ? "Period to " + M.date(period) : added ? "Added " + M.date(added) : "No issue date"].filter(Boolean).join(" · ");
  }
  // "Superseded by <the issue that replaced it>", or plain "Superseded" when that issue is not recorded or can't be read here.
  function supersededMark(d, docs) {
    if (!isSuperseded(d)) return null;
    const by = d.superseded_by != null ? list(docs).find((x) => x && x.id === d.superseded_by) : null;
    return by ? "Superseded by " + M.docTitle(by) : "Superseded";
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
    for (const p of items) { const k = (M.docKind(p.doc.doc_type) || "File").replace(/\b[A-Z](?=[a-z])/g, (c) => c.toLowerCase()); counts.set(k, (counts.get(k) || 0) + 1); }
    const words = [...counts].map(([k, c]) => (c > 1 ? k + " (" + c + ")" : k));
    return words.length > 3 ? words.slice(0, 3).join(", ") + " and more" : words.length > 1 ? words.slice(0, -1).join(", ") + " and " + words[words.length - 1] : words[0] || "";
  }

  // ---- UI2: the kind of each file, as a heading over the main documents and a small line icon on every row ----------
  // The main documents keep their order (docTier's kind order, then newest first); a heading is drawn where the kind changes.
  const KIND_HEADS = ["Farm plans", "Consents and decisions", "Nutrient budgets", "Maps", "Reports"];
  const kindHead = (p) => (String(p.doc.doc_type || "").toLowerCase() === "onboarding_report" ? "Onboarding reports" : KIND_HEADS[p.tier.weight] || "Other files");
  const PLAN = /fep|fwfp|plan/, CONSENT = /consent|aee|decision|nzfap/, MAPDOC = /map|gis|land_unit/, REPORT = /report|budget|overseer|luc|ghg|audit/;
  function iconOf(p) {
    const t = String(p.doc.doc_type || "").toLowerCase();
    if (p.tier.tier === "primary") return ["plan", "consent", "report", "mapdoc", "report"][p.tier.weight] || (t === "onboarding_report" ? "report" : "file");
    return PLAN.test(t) ? "plan" : CONSENT.test(t) ? "consent" : MAPDOC.test(t) ? "mapdoc" : REPORT.test(t) ? "report" : "file";
  }
  const iconSvg = (name) => I ? '<span class="doc-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" focusable="false"><path d="' +
    esc(I.PATHS[name] || I.PATHS.file) + '"/></svg></span>' : "";
  // The main documents under one heading per kind, each kind its own list
  function mainHtml(primaries, o, d) {
    const runs = [];
    for (const p of primaries) { const h = kindHead(p); if (!runs.length || runs[runs.length - 1].h !== h) runs.push({ h, items: [] }); runs[runs.length - 1].items.push(p); }
    return runs.map((r) => '<h4 class="doc-kind-head">' + esc(r.h) + '</h4><ul class="doc-list doc-main">' + r.items.map((p) => primaryHtml(p, o, d)).join("") + "</ul>").join("");
  }

  // ---- markup (pure) -------------------------------------------------------------------------------------------
  function rowHtml(p, o, data, note) {
    const d = p.doc, title = M.docTitle(d), mine = o.selected != null && String(o.selected) === String(d.id);
    const name = d.storage_path ? '<button type="button" class="doc-open" data-open-document="' + esc(d.id) + '">' + esc(title) + "</button>" : "<span>" + esc(title) + "</span>";
    const move = data.canEdit ? '<button type="button" class="doc-move" data-doc-move="' + esc(d.id) + '" aria-expanded="false" aria-label="Change where ' + esc(title) + ' sits"><span aria-hidden="true">•••</span></button>' : "";
    const save = canDownload(d) ? '<button type="button" class="doc-download" data-download-document="' + esc(d.id) + '" aria-label="Download ' + esc(title) + '">Download</button>' : "";
    return '<li class="doc' + (mine ? " selected-record" : "") + '" data-item-id="' + esc(d.id) + '" data-doc-tier="' + esc(p.tier.tier) + '" tabindex="-1">' +
      '<div class="doc-head">' + iconSvg(iconOf(p)) + '<p class="doc-title">' + name + "</p>" + (save || move ? '<span class="doc-actions-end">' + save + move + "</span>" : "") + "</div>" +
      '<p class="doc-source">' + esc([note, supersededMark(d, data.documents), sourceLine(d)].filter(Boolean).join(" · ")) + "</p>" + requestedHtml(data, d);
  }
  const canDownload = (d) => !!d.storage_path && String(d.doc_type || "").toLowerCase() !== "onboarding_report";   // an onboarding report opens as a checklist
  // FU4: a plan with an open "Read this plan in" request says so wherever it is listed, not only on the line after it was filed.
  function requestedHtml(data, d) {
    const ask = openRequest(data.requests, d.id);
    return ask ? '<p class="doc-requested" data-doc-requested="' + esc(d.id) + '">Read-in ' + esc(askedLine(ask, data.userId)) + "</p>" : "";
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
    return rowHtml(p, o, data) + foldHtml(p.children, o, data, plural(n, "supporting file", "supporting files")) + "</li>";
  }
  // The search field's label is shown (a placeholder is not a label); the placeholder gives an example instead.
  const searchHtml = (value = "", results = "") => '<div class="doc-search"><label><span class="doc-search-label">Search files</span>' +
    '<input type="search" data-doc-search autocomplete="off" spellcheck="false" placeholder="e.g. S-map, consent, 2024" value="' + esc(value) + '"></label>' +
    '<div class="doc-results" aria-live="polite">' + results + "</div></div>";
  const addHtml = () => '<div class="doc-add"><label class="doc-drop"><input type="file" multiple data-doc-file class="visually-hidden"><span>Add files</span></label>' +
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
    }).sort((a, b) => ["archive", "superseded"].includes(a.tier.tier) - ["archive", "superseded"].includes(b.tier.tier) || newest(a.doc, b.doc));
  }
  function resultsHtml(data, o, q) {
    if (!text(q)) return "";
    const docs = list(data?.documents), byId = new Map(docs.map((d) => [d.id, d])), found = search(docs, q);
    if (!found.length) return '<p class="doc-none">Nothing matches “' + esc(q.trim()) + "”.</p>";
    const note = (p) => p.tier.tier === "archive" ? "Archived" : p.tier.tier === "supporting" && byId.get(p.doc.relates_to) ? "With " + M.docTitle(byId.get(p.doc.relates_to)) : null;
    return '<ul class="doc-list">' + found.slice(0, MAX_RESULTS).map((p) => rowHtml(p, o, data, note(p)) + "</li>").join("") + "</ul>" +
      (found.length > MAX_RESULTS ? '<p class="doc-none">' + found.length + " match; the first " + MAX_RESULTS + " are shown.</p>" : "");
  }

  // B3DZ/FU4: after a plan is filed, one plain line per plan. "Read this plan in" records a request (never an import); once the plan has
  // an open request the line says who asked and when (you, or the name they had) and leads to the checklist, where an advisor confirms.
  const nzDates = new Intl.DateTimeFormat("en-NZ", { day: "numeric", month: "short", year: "numeric", timeZone: "Pacific/Auckland" });
  const openRequest = (requests, id) => list(requests).find((r) => r && r.status === "requested" && String(r.document_id) === String(id)) || null;
  const askedLine = (r, userId) => "requested by " + (userId && String(r.requested_by) === String(userId) ? "you" : text(r.requested_by_name) || "a farm editor") + ", " +
    (Number.isFinite(Date.parse(r.requested_at)) ? nzDates.format(new Date(r.requested_at)) : "date not recorded");
  function offerHtml(offer, href, requests, userId) {
    return list(offer).filter((o) => o && text(o.title)).map((o) => {
      const ask = openRequest(requests, o.id);
      if (ask) return '<p class="doc-offer" role="status" data-doc-requested="' + esc(o.id) + '">Read this plan in: ' + esc(askedLine(ask, userId)) + ". " + esc(o.title) +
        ' waits for an advisor to check it and confirm; nothing is loaded before that. <a class="doc-queue" href="' + esc(href) + '">See it on the checklist</a></p>';
      return '<p class="doc-offer" role="status"><button type="button" class="doc-read-in" data-doc-read-in="' + esc(o.id) + '">Read this plan in</button> ' +
        esc(o.title) + ": an advisor checks what it holds and confirms before anything is loaded.</p>";
    }).join("");
  }
  function state(data) {
    const n = list(data?.documents).length;
    return n === 0 ? "empty" : n < 3 ? "sparse" : "full";
  }
  // ---- PH3: Files as a file explorer (folders, then files) ------------------------------------------------------------------------
  // The owner's direction (13 Nov 2026): on a phone Files looks like a phone's Files app or Dropbox. There is no folder column in the
  // database, so the folders are the categories the files already carry: their kind (doc_type), read with docTier's kind order, and a
  // few title words for reference documents. A file sits in exactly one folder. Empty folders are not shown; with only one folder
  // its files are listed straight away. The archive stays out of the folders (search finds it), as before; a superseded file sits in
  // its kind's folder, after the current ones, and says so. A group's own files and what member farms shared (data.shared) are read
  // exactly as before; the shared ones are their own folder. Who can see a file is unchanged: only what the host read is listed.
  const FOLDERS = [["plans", "Plans"], ["consents", "Consents"], ["reports", "Reports"], ["maps", "Maps"], ["resources", "Resources"],
    ["notes", "Notes and letters"], ["agreements", "Agreements"], ["other", "Other files"], ["shared", "Shared by member farms"]];
  const FLAT_MAX = 6;
  const folderLabel = (key) => (FOLDERS.find(([k]) => k === key) || [, "Files"])[1];
  // Where a file goes, in this order (PH3, review of #537): (1) its own kind, when the kind says what it is (a plan, consent, report,
  // map, agreement, soil fact sheet, or a letter or email, which stays with the letters whatever it is about); (2) for a file whose kind
  // says nothing (notes, other, none): a consent word or a consent number (CRC...) in the title goes to Consents; (3) other title words
  // (reference material, a plan, a map, a report); (4) notes to Notes and letters, anything else to Other files.
  const CONSENT_WORD = /\bconsents?\b|\bCRC\s?\d/i;
  // Reference material: a file whose title calls it a guide, protocol, template, form, handbook and the like ("resource consent" is a consent)
  const RESOURCE = /\b(protocols?|guides?|guidance|handbooks?|manuals?|templates?|forms?|fact ?sheets?|factsheets?|how[\s-]to|toolkits?|references?|resources?(?!\s+consents?)|checklists? for)\b/i;
  const PLAN_WORD = /\bplans?\b/i, REPORT_WORD = /\breports?\b|\bbudgets?\b|\bmonitoring\b|\bresults?\b/i, MAP_WORD = /\bmaps?\b/i;
  const LETTERS = ["correspondence", "letter", "letters", "email", "e_mail"];
  function folderOf(doc) {
    const t = String(doc?.doc_type || "").toLowerCase().trim().replace(/[\s-]+/g, "_"), title = String(doc?.title || "");
    // (1) its own kind
    if (t === "agreement") return "agreements";
    if (t === "smap_factsheet" || ["guidance", "reference", "resource"].includes(t)) return "resources";
    if (LETTERS.includes(t)) return "notes";
    if (t === "fep_audit") return "plans";
    if (t === "consent_correspondence" || CONSENT.test(t)) return "consents";
    if (["gis_artifact", "map_extract", "land_unit_map", "farm_map"].includes(t)) return "maps";
    if (["group_update", "measurements"].includes(t) || (t && REPORT.test(t))) return "reports";
    const c = M.docTier({ ...doc, tier: null, status: null });
    if (c.tier === "primary") return ["plans", "consents", "reports", "maps", "reports", "reports"][c.weight] || "other";
    // (2) consent words, (3) other title words
    if (CONSENT_WORD.test(title)) return "consents";
    if (RESOURCE.test(title)) return "resources";
    if (PLAN_WORD.test(title)) return "plans";
    if (MAP_WORD.test(title)) return "maps";
    if (REPORT_WORD.test(title)) return "reports";
    // (4)
    if (["memo", "note", "notes"].includes(t)) return "notes";
    return "other";
  }
  const nameOrder = (a, b) => String(M.docTitle(a.doc)).localeCompare(String(M.docTitle(b.doc)), "en-NZ", { sensitivity: "base", numeric: true }) || String(a.doc.id).localeCompare(String(b.doc.id));
  // Within a folder: current files first, then superseded; each by the sort chosen (newest, the default, or name).
  function sortItems(items, sort) {
    const cmp = sort === "name" ? nameOrder : (a, b) => newest(a.doc, b.doc);
    return [...items].sort((a, b) => (a.tier.tier === "superseded") - (b.tier.tier === "superseded") || cmp(a, b));
  }
  // { folders: [{ key, label, items }] } in FOLDERS order, empty ones left out; archived files are not in any folder.
  function folders(docs, o = {}) {
    const a = arrange(docs), by = new Map(FOLDERS.map(([k]) => [k, []]));
    for (const p of a.all) if (p.tier.tier !== "archive") by.get(folderOf(p.doc)).push(p);
    for (const doc of list(o.shared)) if (doc && doc.id != null) by.get("shared").push({ doc, tier: { tier: "shared" }, shared: true });
    return { folders: FOLDERS.map(([key, label]) => ({ key, label, items: sortItems(by.get(key), o.sort) })).filter((f) => f.items.length), archive: a.archive };
  }
  // A short date and the size (or the kind when the size is not recorded): "1 Aug 2024 · 2.1 MB", "Shared 20 Sept 2026 · Ridge Road"
  const dateOf = (d) => day(d.date_prepared) || day(d.period_end) || day(d.created_at);
  function fileLine(p, data) {
    const d = p.doc;
    if (p.shared) return [text(d.attribution) || null, day(d.created_at) ? "shared " + M.date(day(d.created_at)) : null].filter(Boolean).join(" · ");
    const kind = M.docKind(d.doc_type), when = dateOf(d), bytes = Number(d.size_bytes);
    // a supporting file says which main file it is with (review of #537), quietly, after its date
    const main = p.tier.tier === "supporting" && d.relates_to != null ? list(data.documents).find((x) => x && x.id === d.relates_to) : null;
    return [supersededMark(d, data.documents), when ? M.date(when) : null, Number.isFinite(bytes) && bytes > 0 ? size(bytes) : !kind || kind === "Other" ? null : kind,
      main ? "with " + M.docTitle(main) : null].filter(Boolean).join(" · ") || "No date recorded";
  }
  const ICON_OF_FOLDER = { plans: "plan", consents: "consent", reports: "report", maps: "mapdoc" };
  const svg = (name, n = 20) => '<svg viewBox="0 0 24 24" width="' + n + '" height="' + n + '" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="' +
    esc((I && (I.PATHS[name] || I.PATHS.file)) || "") + '"/></svg>';
  // One file: its kind's icon, the name (a tap opens it), one quiet line; one quiet control at the right: "•••" for an editor (Download
  // and where it sits), the download arrow for anyone else. The name's button covers the row, so the whole row is the tap target.
  function fxFileHtml(p, o, data, note) {
    const d = p.doc, title = M.docTitle(d), mine = o.selected != null && String(o.selected) === String(d.id);
    const icon = p.shared ? "file" : ICON_OF_FOLDER[folderOf(d)] || iconOf(p);
    const name = d.storage_path ? '<button type="button" class="doc-open fx-name" data-open-document="' + esc(d.id) + '">' + esc(title) + "</button>" : '<span class="fx-name">' + esc(title) + "</span>";
    const end = !p.shared && data.canEdit ? '<button type="button" class="doc-move fx-more" data-doc-move="' + esc(d.id) + '" aria-expanded="false" aria-label="More for ' + esc(title) + '">' + svg("more") + "</button>"
      : !p.shared && canDownload(d) ? '<button type="button" class="doc-download fx-get" data-download-document="' + esc(d.id) + '" aria-label="Download ' + esc(title) + '">' + svg("download") + "</button>" : "";
    return '<li class="fx-file' + (mine ? " selected-record" : "") + (p.tier.tier === "superseded" ? " fx-old" : "") + '" data-item-id="' + esc(d.id) + '" data-doc-tier="' + esc(p.tier.tier) + '" tabindex="-1">' +
      '<div class="fx-row"><span class="fx-icon" aria-hidden="true">' + svg(icon) + '</span><span class="fx-text">' + name +
      '<small class="fx-line">' + esc([note, fileLine(p, data)].filter(Boolean).join(" · ")) + "</small></span>" + end + "</div>" + (p.shared ? "" : requestedHtml(data, d)) + "</li>";
  }
  const fxFolderHtml = (f) => '<li><button type="button" class="fx-row fx-folder" data-fx-open="' + esc(f.key) + '"><span class="fx-icon" aria-hidden="true">' + svg("files") +
    '</span><span class="fx-text"><span class="fx-name">' + esc(f.label) + '</span></span><span class="fx-count">' + f.items.length + '<span class="visually-hidden"> ' + (f.items.length === 1 ? "file" : "files") + "</span></span></button></li>";
  const SORTS = { newest: "Newest first", name: "By name" };
  const sortHtml = (sort) => '<button type="button" class="fx-sort" data-fx-sort="' + (sort === "name" ? "newest" : "name") + '" aria-label="Sort: ' + esc(SORTS[sort] || SORTS.newest) + '. Change">' +
    svg("filter", 16) + "<span>" + esc(SORTS[sort] || SORTS.newest) + "</span></button>";
  // What the explorer shows: the folders, or one folder's files with the way up, or (a single folder) its files at the top.
  // st: { folder, sort } (the person's place, kept by the live part); the files of a route's ?item= open in their folder.
  function explorerBody(data, o, st = {}) {
    const d = data || {}, f = folders(d.documents, { shared: d.shared, sort: st.sort });
    // (RF1: an empty Files names its place in its one sentence, where the list would start; the + is how to add one)
    if (!f.folders.length) return '<p class="fx-none">' + (list(d.documents).length ? "Every file here is archived; search to find one." : text(d.place) ? "No files have been added to " + esc(text(d.place)) + " yet." : "No files yet.") + "</p>";
    // a short list needs no folders: up to FLAT_MAX files (or one folder's worth) are listed straight away, newest first
    const all = f.folders.flatMap((x) => x.items);
    if (f.folders.length === 1 || all.length <= FLAT_MAX) {
      const items = sortItems(all, st.sort);
      return '<nav class="fx-crumbs" aria-label="Files"><span class="fx-here fx-total">' + esc(plural(items.length, "file", "files")) + "</span>" + (items.length > 1 ? sortHtml(st.sort) : "") + "</nav>" +
        '<ul class="fx-list fx-files" data-fx-folder="">' + items.map((p) => fxFileHtml(p, o, d)).join("") + "</ul>";
    }
    const holding = o.selected != null ? f.folders.find((x) => x.items.some((p) => String(p.doc.id) === String(o.selected))) : null;
    const key = st.folder === undefined && holding ? holding.key : st.folder;
    const open = f.folders.find((x) => x.key === key);
    if (!open) return '<ul class="fx-list fx-folders" aria-label="Folders">' + f.folders.map(fxFolderHtml).join("") + "</ul>";
    const up = f.folders.length > 1 ? '<button type="button" class="fx-up" data-fx-up data-from="' + esc(open.key) + '">' + svg("back", 18) + "<span>Files</span></button>" +
      '<span class="fx-sep" aria-hidden="true">/</span><h4 class="fx-here" aria-current="location">' + esc(open.label) + "</h4>" : '<h4 class="fx-here">' + esc(open.label) + "</h4>";
    return '<nav class="fx-crumbs" aria-label="Where you are">' + up + (open.items.length > 1 ? sortHtml(st.sort) : "") + "</nav>" +
      '<ul class="fx-list fx-files" data-fx-folder="' + esc(open.key) + '">' + open.items.map((p) => fxFileHtml(p, o, d)).join("") + "</ul>";
  }
  // Search across every file (the archive and the shared ones too), each with the folder it is in.
  function explorerResults(data, o, q) {
    const d = data || {}, docs = list(d.documents), words =String(q || "").toLowerCase().split(/\s+/).map(squash).filter(Boolean), whole = squash(q);
    const found = search(docs, q).map((p) => ({ ...p, note: p.tier.tier === "archive" ? "Archived" : folderLabel(folderOf(p.doc)) }));
    for (const doc of list(d.shared)) {
      const hay = squash([doc.title, M.docKind(doc.doc_type), doc.attribution, doc.original_name].filter(Boolean).join(" "));
      if (words.length && (words.every((w) => hay.includes(w)) || hay.includes(whole))) found.push({ doc, tier: { tier: "shared" }, shared: true, note: folderLabel("shared") });
    }
    if (!found.length) return '<p class="fx-none">Nothing matches “' + esc(String(q).trim()) + "”.</p>";
    return '<ul class="fx-list fx-files fx-found">' + found.slice(0, MAX_RESULTS).map((p) => fxFileHtml(p, o, d, p.note)).join("") + "</ul>" +
      (found.length > MAX_RESULTS ? '<p class="fx-none">' + found.length + " match; the first " + MAX_RESULTS + " are shown.</p>" : "");
  }
  function explorerHtml(d, o, ctx, docs) {
    const h = ctx.level, title = text(d.title) || "Files", total = docs.length + list(d.shared).length;
    const heading = "<h" + h + ' class="block-title' + (ctx.nested ? " visually-hidden" : "") + '">' + esc(title) + "</h" + h + ">";
    const notice = text(d.notice) ? '<p class="doc-notice" role="status">' + esc(d.notice) + "</p>" : "";
    const offered = text(d.readInHref) ? offerHtml(d.offer, d.readInHref, d.requests, d.userId) : "";
    // a route that names an archived file opens with it found, as before
    const picked = o.selected != null ? arrange(docs).archive.find((p) => String(p.doc.id) === String(o.selected)) : null;
    const q = picked ? M.docTitle(picked.doc) : "";
    const searchBox = total ? '<div class="fx-bar"><label class="fx-search">' + svg("search", 18) + '<span class="visually-hidden">Search files</span><input type="search" data-doc-search data-fx-search autocomplete="off" spellcheck="false" placeholder="Search files" value="' + esc(q) + '"></label></div>' : "";
    return '<section class="documents-block fx" data-documents="' + docs.length + '">' + heading + notice + offered + searchBox +
      '<div class="fx-body" aria-live="polite">' + (q ? explorerResults(d, o, q) : explorerBody(d, o)) + "</div>" + (d.canAdd ? addHtml() : "") + "</section>";
  }

  function render(data, o, ctx) {
    const d = data || {}, docs = list(d.documents), h = ctx.level;
    const title = text(d.title) || "Files";
    if (o.explorer) return explorerHtml(d, o, ctx, docs);
    if (!docs.length && !d.canAdd) return "";
    const a = arrange(docs, o);
    const heading = "<h" + h + ' class="block-title' + (ctx.nested ? " visually-hidden" : "") + '">' + esc(title) + "</h" + h + ">";
    const main = a.primaries.length ? mainHtml(a.primaries, o, d) : "";
    const more = a.more.length ? '<details class="doc-fold doc-more"' + (holds(a.more.concat(a.more.flatMap((p) => p.children)), o) ? " open" : "") + "><summary><span>" +
      esc(plural(a.more.length, "more main file", "more main files")) + '</span></summary><ul class="doc-list">' + a.more.map((p) => primaryHtml(p, o, d)).join("") + "</ul></details>" : "";
    const loose = foldHtml(a.loose, o, d, a.primaries.length ? plural(a.loose.length, "other supporting file", "other supporting files") : plural(a.loose.length, "supporting file", "supporting files"), "doc-loose");
    const replaced = foldHtml(a.superseded, o, d, plural(a.superseded.length, "superseded file", "superseded files"), "doc-replaced");
    const archived = o.show_archive ? foldHtml(a.archive, o, d, plural(a.archive.length, "archived file", "archived files"), "doc-archive") : "";
    // The archive is found by search. A route that names an archived document opens with it found.
    const picked = !o.show_archive && o.selected != null ? a.archive.find((p) => String(p.doc.id) === String(o.selected)) : null;
    const searchable = docs.length > 6 || a.archive.length > 0;
    const notice = text(d.notice) ? '<p class="doc-notice" role="status">' + esc(d.notice) + "</p>" : "";
    const offered = text(d.readInHref) ? offerHtml(d.offer, d.readInHref, d.requests, d.userId) : "";
    const none = !docs.length ? (ctx.nested ? "" : '<p class="doc-none">No files yet.</p>') : !a.primaries.length && !a.loose.length && !a.superseded.length && !archived ? '<p class="doc-none">' +
      (o.kinds.length ? "None of these kinds is recorded." : "Every file here is archived; search to find one.") + "</p>" : "";
    return '<section class="documents-block" data-documents="' + docs.length + '">' + heading + notice + offered + none + main + more + loose + replaced + archived +
      (searchable ? searchHtml(picked ? M.docTitle(picked.doc) : "", picked ? resultsHtml(d, o, M.docTitle(picked.doc)) : "") : "") +
      (d.canAdd ? addHtml() : "") + "</section>";
  }

  // ---- upload and move: the confirm step and the tier menu (pure markup, wired in mounted) --------------------
  const size = (n) => (n >= 1048576 ? (n / 1048576).toFixed(n >= 10485760 ? 0 : 1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB");
  // One guess per file, in order: a file can sit under a main document chosen earlier in the same batch (key "new:<n>"),
  // so a plan's PDF and its workbook dropped together are one main document and its other format.
  // found[i]: what C.sniff made of file i (an FEP generation the plan reader knows) or null. A workbook the name does not
  // call a plan is filed as a plan when its sheets say so; a working copy (archive) stays where its name put it.
  function guessBatch(files, primaries, found = []) {
    const mains = list(primaries).map((p) => ({ id: p.id, title: M.docTitle(p), doc_type: p.doc_type, original_name: p.original_name, date_prepared: p.date_prepared }));
    return list(files).map((file, i) => {
      let guess = C.rules(file, mains);
      const gen = found?.[i] || null, key = "new:" + i;
      if (gen && guess.tier !== "archive") {
        guess = guess.doc_type === "fep" ? { ...guess, generation: gen.id, because: "its sheets are " + gen.label }
          : { ...guess, doc_type: "fep", tier: "primary", relates_to: null, generation: gen.id, because: "its sheets are " + gen.label };
      }
      if (guess.tier === "primary") mains.push({ id: key, title: guess.title, doc_type: guess.doc_type, original_name: file.name });
      return { key, file, name: file.name, bytes: file.size, guess, tooBig: file.size > MAX_BYTES };
    });
  }
  // The plan the farm already has among its main documents (the one shown first), or null. A second plan is never filed
  // over it: the Documents list keeps every main document, newest first (arrange), so this one sits beside the other.
  const heldPlan = (primaries) => list(primaries).filter((p) => p && M.isPlan(p)).sort(newest)[0] || null;
  const planKind = (kind) => ["fep", "fwfp"].includes(kind);
  function confirmHtml(items, primaries) {
    const mains = list(primaries).map((p) => [String(p.id), M.docTitle(p)]), held = heldPlan(primaries);
    const fields = items.map((it, i) => {
      const g = it.guess, here = [...mains, ...items.slice(0, i).filter((x) => x.guess.tier === "primary").map((x) => [x.key, x.guess.title])];
      const radio = (t, label) => '<label><input type="radio" name="tier-' + i + '" value="' + t + '"' + (g.tier === t ? " checked" : "") + "> " + label + "</label>";
      return '<fieldset class="doc-item" data-doc-item="' + i + '"' + (it.tooBig ? " disabled" : "") + "><legend>" + esc(it.name) + " · " + esc(size(it.bytes)) + "</legend>" +
        (it.tooBig ? '<p class="doc-none">Too large to add here (over 100 MB).</p>' :
        '<label class="doc-field"><span>Title</span><input name="title-' + i + '" value="' + esc(g.title) + '" required></label>' +
        '<label class="doc-field"><span>Kind</span><select name="kind-' + i + '">' + C.KINDS.map(([k, label]) => '<option value="' + k + '"' + (k === g.doc_type ? " selected" : "") + ">" + esc(label) + "</option>").join("") + "</select></label>" +
        '<label class="doc-field"><span>Issue date</span><input type="date" name="issued-' + i + '"></label>' +
        (g.generation ? '<p class="doc-detected">It reads as ' + esc(C.GENERATIONS.find((x) => x[0] === g.generation)?.[1] || "a Farm Environment Plan") + ", so it is offered as the farm's main plan.</p>" : "") +
        '<div class="doc-tiers" role="radiogroup" aria-label="Where it sits">' + radio("primary", "Main") + radio("supporting", "Supporting") + radio("archive", "Archive") + "</div>" +
        (held ? '<p class="doc-plan-note"' + (g.tier === "primary" && planKind(g.doc_type) ? "" : " hidden") + ">This farm already has a main plan: " + esc(M.docTitle(held)) +
          ". This one is added beside it as another main file; nothing is replaced. If it is an older copy, choose Archive.</p>" : "") +
        '<label class="doc-field doc-under"' + (g.tier === "supporting" ? "" : " hidden") + '><span>With</span><select name="under-' + i + '"><option value="">No main file</option>' +
          here.map(([id, t]) => '<option value="' + esc(id) + '"' + (id === g.relates_to ? " selected" : "") + ">" + esc(t) + "</option>").join("") + "</select></label>") + "</fieldset>";
    }).join("");
    const n = items.filter((it) => !it.tooBig).length;
    return '<form class="doc-confirm-form" novalidate>' + fields + '<p class="doc-msg" role="status" aria-live="polite"></p><div class="doc-actions">' +
      (n ? '<button type="submit">' + (n === 1 ? "Add file" : "Add " + n + " files") + "</button>" : "") + '<button type="button" class="link" data-doc-cancel>Cancel</button></div></form>';
  }
  // A drop, read: each file's sheets looked at on the device (C.sniff), then one guess per file. files: File[] (copied first,
  // so the input can be cleared); primaries: the farm's main documents.
  async function readDrop(files, primaries) {
    const picked = [...files], found = await Promise.all(picked.map((file) => C.sniff(file)));
    return guessBatch(picked, primaries, found);
  }
  // The confirmed choices saved one by one through the store's add (the existing upload: storage, then one documents insert
  // with the chosen tier, which the database stamps tiered_at for). Returns { ids, failed, offer }: offer lists the plans
  // just filed as main documents (kind fep), for the "Read this plan in" line. Nothing else is called on the store.
  async function saveChoices(choices, store, stale = () => false) {
    const ids = new Map(), failed = [];
    for (const c of choices) {
      if (stale()) return null;
      try { ids.set(c.key, await store.add({ ...c, relates_to: c.relates_to && c.relates_to.startsWith("new:") ? ids.get(c.relates_to) || null : c.relates_to })); }
      catch (err) { failed.push(c.title + ": " + (err?.message || err)); }
    }
    const offer = choices.filter((c) => c.doc_type === "fep" && c.tier === "primary" && ids.get(c.key) != null).map((c) => ({ id: ids.get(c.key), title: c.title }));
    return { ids, failed, offer };
  }
  // Read the confirmed choices back out of the form: one { key, file, title, doc_type, tier, relates_to } per file.
  function confirmed(items, value) {
    return items.map((it, i) => it.tooBig ? null : (() => {
      const tier = value("tier-" + i) || it.guess.tier, under = tier === "supporting" ? value("under-" + i) || null : null;
      return { key: it.key, file: it.file, title: String(value("title-" + i) || it.guess.title).trim() || it.guess.title, doc_type: value("kind-" + i) || it.guess.doc_type, tier, relates_to: under, date_prepared: day(value("issued-" + i)) };
    })()).filter(Boolean);
  }
  // Primaries first, so a file can sit under a main document added in the same batch.
  const saveOrder = (choices) => [...choices].sort((a, b) => (a.tier !== "primary") - (b.tier !== "primary"));
  function moveHtml(doc, data) {
    const docs = list(data?.documents), a = arrange(docs), here = placeOf(doc, docs.some((x) => x.relates_to === doc.id)).tier;
    const others = [...a.primaries, ...a.more].filter((p) => p.doc.id !== doc.id);
    const opt = (attrs, label, current) => '<li><button type="button" ' + attrs + (current ? ' aria-current="true"' : "") + ">" + esc(label) + "</button></li>";
    return '<ul class="doc-menu" data-doc-menu="' + esc(doc.id) + '">' + opt('data-doc-set="primary"', "Main file", here === "primary") +
      others.map((p) => opt('data-doc-set="supporting" data-doc-under="' + esc(p.doc.id) + '"', "With " + M.docTitle(p.doc), here === "supporting" && doc.relates_to === p.doc.id)).join("") +
      opt('data-doc-set="archive"', "Archive", here === "archive") + (data?.canSupersede ? supersedeOptions(doc, others, opt) : "") + "</ul>";
  }
  // PH3: an editor's "•••" in the explorer: Download first (one control per row instead of two), then where the file sits, as before.
  function explorerMenuHtml(doc, data) {
    const get = canDownload(doc) ? '<li><button type="button" data-download-document="' + esc(doc.id) + '">Download</button></li>' : "";
    return moveHtml(doc, data).replace(/^(<ul class="doc-menu)(" data-doc-menu="[^"]*">)/, "$1 fx-menu$2" + get);
  }
  // V5: staff only (the database refuses anyone else). A superseded file can be brought back; a current one names the issue that replaces it.
  const supersedeOptions = (doc, others, opt) => isSuperseded(doc) ? opt('data-doc-supersede=""', "Not superseded")
    : others.map((p) => opt('data-doc-supersede="' + esc(p.doc.id) + '"', "Superseded by " + M.docTitle(p.doc))).join("");
  // The update a menu choice sends: a primary or an archived document sits under nothing (F1e's constraint).
  const change = (tier, under) => ({ tier, relates_to: tier === "supporting" ? under || null : null });

  // The content address the loader uses (tools/load_documents.py) and the database insists on: <farm>/<sha256><.ext>.
  const storagePath = (owner, sha, name) => String(owner) + "/" + sha + C.extension(name);
  async function sha256Hex(bytes) {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  // ---- the file's name (V5) ------------------------------------------------------------------------------------
  // The name a file is saved under: its original name, made safe to pass on. Path parts, control and invisible characters and the
  // characters Windows refuses go; a name left empty falls back to the title, with the stored file's extension; the extension survives the
  // length limit. Everything else (spaces, &, #, %, +, accents) is kept: downloadHref encodes it for the query string, and Storage encodes it again
  // for the Content-Disposition header it writes from that query value.
  function downloadName(doc) {
    const clean = (v) => String(v ?? "").normalize("NFC").split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, "")
      .replace(/[<>:"|?*]/g, "_").replace(/^[\s.]+|[\s.]+$/g, "");
    const ext = (/\.[a-z0-9]{1,10}$/i.exec(String(doc?.storage_path || "")) || [""])[0];
    let name = clean(doc?.original_name);
    if (!name) { const t = clean(M.docTitle(doc || {})); name = (t || "document") + (t.toLowerCase().endsWith(ext.toLowerCase()) ? "" : ext); }
    const chars = [...name], LIMIT = 180;
    if (chars.length <= LIMIT) return name;
    const dot = name.lastIndexOf("."), tail = dot > 0 && name.length - dot <= 11 ? name.slice(dot) : "";
    return chars.slice(0, LIMIT - [...tail].length).join("") + tail;
  }
  // The signed URL with the file's name as its download parameter (Storage answers with Content-Disposition: attachment and that name). Added here,
  // encoded, rather than through createSignedUrl's download option: that option does not encode "&" or "#", which would cut the name short.
  const downloadHref = (signedUrl, name) => signedUrl + (String(signedUrl).includes("?") ? "&" : "?") + "download=" + encodeURIComponent(name);

  // ---- the live part (browser) -------------------------------------------------------------------------------
  function mounted(host, data, o, ctx) {
    const rootEl = host.querySelector(".documents-block");
    if (!rootEl) return null;
    const store = ctx.store || null, d = data || {};
    const primaries = () => { const a = arrange(list(d.documents)); return [...a.primaries, ...a.more].map((p) => p.doc); };
    const input = rootEl.querySelector("[data-doc-search]"), results = rootEl.querySelector(".doc-results");
    // PH3: the explorer keeps the person's place (folder, sort) on the host, so drawing the block again (after an upload) keeps it
    const fx = rootEl.classList?.contains("fx") ? rootEl.querySelector(".fx-body") : null;
    const place = fx ? (host.__fx ||= {}) : null;
    const drawBody = () => { if (fx) fx.innerHTML = text(input?.value) ? explorerResults(d, o, input.value) : explorerBody(d, o, place); };
    if (fx && (place.folder !== undefined || place.sort) && !text(input?.value)) drawBody();
    if (fx) input?.addEventListener("input", drawBody);
    else input?.addEventListener("input", () => { results.innerHTML = resultsHtml(d, o, input.value); });
    let items = [], unfit = null;
    const box = rootEl.querySelector(".doc-confirm"), drop = rootEl.querySelector(".doc-drop");
    async function choose(files) {
      const picked = [...files];
      if (!box || !picked.length) return;
      const made = await readDrop(picked, primaries());
      if (ctx.stale()) return;
      items = made;
      box.innerHTML = confirmHtml(items, primaries()); box.hidden = false; drop.hidden = true;
      // PH4: in the explorer (a place's Files, where the + adds a file) the step is the one pattern for add forms: it takes the screen on
      // a phone, Cancel and Add in one thin top row with its title between them, the file's fields as plain rows (ui.css "doc-sheet")
      const form = box.querySelector(".doc-confirm-form"), acts = form?.querySelector(".doc-actions");
      if (fx && form && acts && globalThis.document) {
        const n = items.filter((it) => !it.tooBig).length;
        // (a farm's Files inside its map's sheet keeps the step in that sheet: the rows, without taking the screen)
        form.classList.add("fs-sheet", "doc-sheet", ...(rootEl.closest("#space-content") ? [] : ["fs-page"]));
        acts.classList.add("fs-top");
        acts.append(Object.assign(globalThis.document.createElement("h2"), { className: "fs-title", textContent: n > 1 ? "Add " + n + " files" : "Add a file" }));
        const body = globalThis.document.createElement("div");
        body.className = "fs-body";
        body.append(...[...form.children].filter((c) => c !== acts));
        form.append(body);
        unfit?.(); unfit = globalThis.FP?.formRows?.fit?.(box) || null;   // (the keyboard never covers the field being typed in or Add)
      }
      box.querySelector("input[name^=title-]")?.focus();
    }
    function closeConfirm() { if (!box) return; unfit?.(); unfit = null; items = []; box.innerHTML = ""; box.hidden = true; drop.hidden = false; }
    rootEl.querySelector("[data-doc-file]")?.addEventListener("change", (e) => { choose(e.target.files || []); e.target.value = ""; });
    if (drop) {
      for (const t of ["dragenter", "dragover"]) rootEl.addEventListener(t, (e) => { if (!e.dataTransfer?.types?.includes("Files")) return; e.preventDefault(); drop.classList.add("doc-drop-over"); });
      rootEl.addEventListener("dragleave", (e) => { if (!rootEl.contains(e.relatedTarget)) drop.classList.remove("doc-drop-over"); });
      rootEl.addEventListener("drop", (e) => { if (!e.dataTransfer?.files?.length) return; e.preventDefault(); drop.classList.remove("doc-drop-over"); choose(e.dataTransfer.files); });
    }
    rootEl.addEventListener("change", (e) => {
      const radio = e.target.closest?.('.doc-tiers input[type="radio"]'), fieldset = e.target.closest?.("fieldset.doc-item");
      if (radio) fieldset.querySelector(".doc-under").hidden = radio.value !== "supporting";
      const note = fieldset?.querySelector(".doc-plan-note");
      if (note) note.hidden = !(fieldset.querySelector('.doc-tiers input:checked')?.value === "primary" && planKind(fieldset.querySelector("select[name^=kind-]")?.value));
    });
    rootEl.addEventListener("submit", async (e) => {
      if (!e.target.matches(".doc-confirm-form")) return;
      e.preventDefault();
      const form = e.target, msg = form.querySelector(".doc-msg"), button = form.querySelector('button[type="submit"]');
      const value = (name) => form.elements.namedItem(name)?.value ?? null;   // a radio group reads as its checked value
      const choices = saveOrder(confirmed(items, value));
      if (!store) { msg.textContent = "Not added: nothing here saves files."; return; }
      button.disabled = true; msg.textContent = choices.length === 1 ? "Adding…" : "Adding " + choices.length + " files…";
      const saved = await saveChoices(choices, store, ctx.stale);
      if (!saved || ctx.stale()) return;
      const { failed, offer } = saved, added = choices.length - failed.length;
      if (!failed.length) { await store.changed(added === 1 ? "Added " + choices[0].title + "." : "Added " + added + " files.", { offer }); return; }
      button.disabled = false;
      msg.textContent = (added ? "Added " + added + ". " : "") + "Not added: " + failed.join("; ");
      if (added) await store.changed(msg.textContent, { offer });
    });
    rootEl.addEventListener("click", async (e) => {
      if (e.target.closest("[data-doc-cancel]")) { closeConfirm(); return; }
      // PH3: into a folder, up to the folders, and the one sort control (newest first, or by name)
      const into = e.target.closest("[data-fx-open]"), up = e.target.closest("[data-fx-up]"), sort = e.target.closest("[data-fx-sort]");
      if (fx && (into || up || sort)) {
        if (into) place.folder = into.dataset.fxOpen;
        if (up) place.folder = null;
        if (sort) place.sort = sort.dataset.fxSort;
        drawBody();
        // the focus stays with the person: on the sort control, the first file of the folder, or the folder just left
        const left = up ? fx.querySelector('[data-fx-open="' + CSS.escape(up.dataset.from || "") + '"]') : null;
        (sort ? fx.querySelector("[data-fx-sort]") : into ? fx.querySelector(".fx-up, .fx-name") : left || fx.querySelector("[data-fx-open]"))?.focus();
        if (into || up) rootEl.scrollIntoView?.({ block: "nearest" });
        return;
      }
      // FU4: "Read this plan in" asks once (the button is gone when the line is drawn again with the request on it).
      const readIn = e.target.closest("[data-doc-read-in]");
      if (readIn) {
        if (readIn.disabled) return;
        readIn.parentElement.querySelector(".doc-msg")?.remove();
        if (!store?.requestReadIn) { readIn.insertAdjacentHTML("afterend", ' <span class="doc-msg" role="status">Not asked: nothing here records the request.</span>'); return; }
        readIn.disabled = true;
        try { await store.requestReadIn(readIn.dataset.docReadIn); if (!ctx.stale()) await store.changed(null, { offer: list(d.offer) }); }
        catch (err) {
          if (ctx.stale()) return;
          readIn.disabled = false;
          readIn.insertAdjacentHTML("afterend", ' <span class="doc-msg" role="status">' + esc("Not asked: " + (err?.message || "the request wasn't recorded.")) + "</span>");
        }
        return;
      }
      // V5: a file saved under its own name. The link is made on the tap, so it is never stale.
      const save = e.target.closest("[data-download-document]");
      if (save) {
        const doc = list(d.documents).find((x) => String(x.id) === save.dataset.downloadDocument);
        if (!doc || !store?.download || save.disabled) return;
        save.disabled = true;
        // PH3 (review of #537): in the explorer the control keeps its icon; what happened is one quiet line under the row, read out
        const said = (words) => {
          const row = save.closest(".fx-file");
          if (!row) { save.textContent = words; return; }
          row.querySelector(".fx-said")?.remove();
          row.querySelector(".fx-row").insertAdjacentHTML("afterend", '<p class="doc-msg fx-said" role="status">' + esc(words) + "</p>");
        };
        try {
          const { url, name } = await store.download(doc);
          const link = Object.assign(document.createElement("a"), { href: url, download: name, rel: "noopener" });
          document.body.append(link); link.click(); link.remove();
          said(fx ? "Downloaded " + name + "." : "Download");
        } catch { said("Couldn't download it"); }
        save.disabled = false;
        return;
      }
      const toggle = e.target.closest("[data-doc-move]");
      if (toggle) {
        const open = rootEl.querySelector('[data-doc-menu="' + CSS.escape(toggle.dataset.docMove) + '"]');
        for (const m of rootEl.querySelectorAll(".doc-menu")) m.remove();
        for (const b of rootEl.querySelectorAll("[data-doc-move]")) b.setAttribute("aria-expanded", "false");
        if (open) return;
        const doc = list(d.documents).find((x) => String(x.id) === toggle.dataset.docMove);
        if (fx) toggle.closest(".fx-file").querySelector(".fx-row").insertAdjacentHTML("afterend", explorerMenuHtml(doc, d));
        else toggle.closest(".doc").querySelector(".doc-head").insertAdjacentHTML("afterend", moveHtml(doc, d));
        toggle.setAttribute("aria-expanded", "true");
        return;
      }
      const set = e.target.closest("[data-doc-set]"), mark = e.target.closest("[data-doc-supersede]");
      if (!set && !mark) return;
      const menu = (set || mark).closest(".doc-menu"), id = menu.dataset.docMenu;
      if (!store) { menu.insertAdjacentHTML("afterend", '<p class="doc-msg" role="status">Not changed: nothing here saves files.</p>'); menu.remove(); return; }
      for (const b of menu.querySelectorAll("button")) b.disabled = true;
      try {
        if (set) await store.move(id, change(set.dataset.docSet, set.dataset.docUnder));
        else await store.supersede(id, mark.dataset.docSupersede || null);
        if (!ctx.stale()) await store.changed(null);
      }
      catch (err) {
        if (ctx.stale()) return;
        menu.insertAdjacentHTML("afterend", '<p class="doc-msg" role="status">' + esc(err?.message || "That change wasn't allowed.") + "</p>"); menu.remove();
      }
    });
    return { primaries };
  }

  const block = blocks.define({
    id: "documents", title: "Files", empty: "No files recorded yet.",
    options: {
      show_archive: { type: "boolean", default: false },   // archived documents as their own folded line, as well as by search
      kinds: { type: "list", default: [] },                // only these document types (doc_type names); none = every kind
      limit: { type: "integer", default: null, min: 1, max: 200 },   // main documents shown before "n more"
      selected: { type: "string", default: null },         // the document to open and mark (a route's ?item=)
      explorer: { type: "boolean", default: false },       // PH3: folders, then files (the Files screens of a farm and a group)
    },
    state, render, mounted,
  });
  return { block, arrange, sourceLine, search, resultsHtml, guessBatch, readDrop, saveChoices, offerHtml, openRequest, askedLine, heldPlan, confirmHtml, confirmed, saveOrder, moveHtml, change, storagePath, sha256Hex, state, MAX_BYTES,
    downloadName, downloadHref, FOLDERS, FLAT_MAX, folderOf, folders, explorerBody, explorerResults, explorerMenuHtml, fileLine };
});
