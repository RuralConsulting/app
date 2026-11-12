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
// plan_import_requests rows], userId?, title? }. render is pure; mounted wires search, upload and moves to ctx.store
// ({ add(item) -> id, move(id, change), changed(), requestReadIn(id), supersede(id, by), download(doc) -> { url, name } }) when the host has one.
// V5 (files that work): each file says its type and issue date, and "Superseded" where it is; a superseded file stays readable, in its
// own fold (status superseded, tier not archive); the Download button saves a file under its original name (downloadName); data.canSupersede
// (RCL staff who can edit) offers "Superseded by ..." in the move menu, and the database enforces it (guard_document_supersession).
// The block calls nothing itself: the host's store does (app/js/document-files.js holds the reads and writes both hosts use).
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
  function render(data, o, ctx) {
    const d = data || {}, docs = list(d.documents), h = ctx.level;
    const title = text(d.title) || "Files";
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
    input?.addEventListener("input", () => { results.innerHTML = resultsHtml(d, o, input.value); });
    let items = [];
    const box = rootEl.querySelector(".doc-confirm"), drop = rootEl.querySelector(".doc-drop");
    async function choose(files) {
      const picked = [...files];
      if (!box || !picked.length) return;
      const made = await readDrop(picked, primaries());
      if (ctx.stale()) return;
      items = made;
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
        try {
          const { url, name } = await store.download(doc);
          const link = Object.assign(document.createElement("a"), { href: url, download: name, rel: "noopener" });
          document.body.append(link); link.click(); link.remove();
          save.textContent = "Download";
        } catch { save.textContent = "Couldn't download it"; }
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
        toggle.closest(".doc").querySelector(".doc-head").insertAdjacentHTML("afterend", moveHtml(doc, d));
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
    },
    state, render, mounted,
  });
  return { block, arrange, sourceLine, search, resultsHtml, guessBatch, readDrop, saveChoices, offerHtml, openRequest, askedLine, heldPlan, confirmHtml, confirmed, saveOrder, moveHtml, change, storagePath, sha256Hex, state, MAX_BYTES,
    downloadName, downloadHref };
});
