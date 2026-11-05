// The group's monthly update (S5, docs/CATCHMENT-SPACE.md): a draft assembled by code from the period's rows the facilitator
// can read (the group's own org-internal entries and documents, what member farms shared with the group, monitoring results
// at the group's sites, the member summary with small numbers held back), each line carrying its sources; then checked again
// at save time against what is still delivered, and rendered as one self-contained HTML document whose embedded manifest
// (group-update-manifest/1) records the inputs and the sharing at the time. Pure: no reads, no DOM, no AI.
(function (root, factory) {
  const api = factory(typeof module === "object" && module.exports ? require("./group-model.js") : root.FP.groupModel);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FP.groupUpdate = api;
})(typeof window === "undefined" ? globalThis : window, function (G) {
  const SCHEMA = "group-update-manifest/1";
  const MODEL = "Group monthly update";
  const VERSION = "1";
  // Sources whose delivery can be withdrawn after the draft was made: checked again before saving.
  const REVOCABLE = ["entry", "shared_entry", "document", "shared_document"];
  const plural = (n, one, many) => n + " " + (n === 1 ? one : many);
  let made = 0;
  const lineId = () => "l" + ++made;

  // inputs: { group: {id, name, member_detail}, period (G.monthPeriod), members (group_member_farms), summary
  // (group_member_summary for the period), ownEntries (org entries with record_type), sharedEntries (group_shared_entries),
  // ownDocuments, sharedDocuments, results ([{site_id, site, parameter, parameter_name, value_text, unit, sampled_at,
  // source_key, attribution, provisional}]), typeLabel(key), now (ISO), by (who assembled it) }
  function assemble(i) {
    const p = i.period, typeLabel = i.typeLabel || ((k) => k), members = i.members || [];
    const own = (i.ownEntries || []).filter((e) => e.visibility !== "private" && G.within(e.captured_at, p));
    const shared = (i.sharedEntries || []).filter((e) => G.within(e.captured_at, p));
    const docs = (i.ownDocuments || []).filter((d) => d.visibility !== "private" && d.doc_type !== "group_update" && G.within(d.created_at, p));
    const sharedDocs = (i.sharedDocuments || []).filter((d) => G.within(d.created_at, p));
    const results = (i.results || []).filter((r) => G.within(r.sampled_at, p));
    const s = i.summary || {};
    const nameOf = (row) => (row?.farm_id && members.find((m) => m.farm_ref === row.farm_id)?.name) || null;
    const src = {
      entry: (e) => ({ kind: "entry", id: e.id, captured_at: e.captured_at }),
      // a shared record's source keeps the attribution the draft used (the farm's ref and the name, if any), so saving
      // can check the group may still attribute it that way
      shared_entry: (e) => ({ kind: "shared_entry", id: e.id, captured_at: e.captured_at, farm: e.farm_id || null, name: nameOf(e) }),
      document: (d) => ({ kind: "document", id: d.id, created_at: d.created_at }),
      shared_document: (d) => ({ kind: "shared_document", id: d.id, created_at: d.created_at, farm: d.farm_id || null, name: nameOf(d) }),
      result: (r) => ({ kind: "result", site_id: r.site_id, parameter: r.parameter, sampled_at: r.sampled_at, source_key: r.source_key }),
      summary: () => ({ kind: "summary", period: p.key }),
    };
    const byType = (rows) => {
      const n = new Map();
      for (const r of rows) n.set(typeLabel(r.record_type), (n.get(typeLabel(r.record_type)) || 0) + 1);
      return [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t, c]) => c + " " + t.toLowerCase()).join(", ");
    };
    const brief = [];
    brief.push({ id: lineId(), text: own.length ? plural(own.length, "record was", "records were") + " added by the group (" + byType(own) + ")." : "No records were added by the group this month.",
      sources: own.map(src.entry) });
    brief.push({ id: lineId(), text: shared.length ? plural(shared.length, "record was", "records were") + " shared with the group by member farms (" + byType(shared) + ")."
      : "No records were shared with the group by member farms this month.", sources: shared.map(src.shared_entry) });
    const c = G.contributing(s);
    if (shared.length && c) brief.push({ id: lineId(), text: c, sources: [src.summary()] });
    if (s.linked_farms != null) brief.push({ id: lineId(), text: s.linked_farms ? plural(s.linked_farms, "member farm is", "member farms are") + " linked in the tool."
      : "No member farms are linked in the tool yet.", sources: [src.summary()] });

    const done = [
      ...own.map((e) => ({ at: e.captured_at, text: G.shortDate(e.captured_at) + " · " + typeLabel(e.record_type) + " · " + (G.firstSentence(e.body, 240) || "no text") + " (the group)", sources: [src.entry(e)] })),
      ...shared.map((e) => ({ at: e.captured_at, text: G.shortDate(e.captured_at) + " · " + typeLabel(e.record_type) + " · " + (G.firstSentence(e.body, 240) || "no text") + " (" + G.attribution(e, members) + ")", sources: [src.shared_entry(e)] })),
    ].sort((a, b) => String(a.at).localeCompare(String(b.at))).map(({ text, sources }) => ({ id: lineId(), text, sources }));

    const monitoring = results.length ? results.slice().sort((a, b) => String(a.site).localeCompare(String(b.site)) || String(a.parameter_name).localeCompare(String(b.parameter_name)))
      .map((r) => ({ id: lineId(), text: r.site + ": " + r.parameter_name + " " + r.value_text + (r.unit ? " " + r.unit : "") + " on " + G.shortDate(r.sampled_at) +
        " (as reported" + (r.provisional ? ", provisional" : "") + "; not assessed against bands). " + (r.attribution || ""), sources: [src.result(r)] }))
      : [{ id: lineId(), text: "No monitoring results were recorded this month at the group's sites.", sources: [] , note: true }];

    const documents = [...docs.map((d) => ({ id: lineId(), text: (d.title || "Untitled") + " (added " + G.shortDate(d.created_at) + ", the group)", sources: [src.document(d)] })),
      ...sharedDocs.map((d) => ({ id: lineId(), text: (d.title || "Untitled") + " (shared " + G.shortDate(d.created_at) + ", " + G.attribution(d, members) + ")", sources: [src.shared_document(d)] }))];

    const sections = [
      { key: "brief", heading: "In brief", lines: brief },
      { key: "done", heading: "What was done", lines: done.length ? done : [{ id: lineId(), text: "Nothing was recorded this month.", sources: [], note: true }] },
      { key: "monitoring", heading: "Monitoring", lines: monitoring },
      { key: "documents", heading: "Documents added", lines: documents.length ? documents : [{ id: lineId(), text: "No documents were added this month.", sources: [], note: true }] },
    ];
    return {
      title: (i.group?.name || "Group") + " — monthly update, " + p.label,
      period: p, group: { id: i.group?.id, name: i.group?.name, member_detail: i.group?.member_detail || s.member_detail || "aggregated" },
      sections, assembled_at: i.now || new Date().toISOString(), assembled_by: i.by || null,
      summary: { linked_farms: s.linked_farms ?? null, farms_in_totals: s.farms_in_totals ?? null, mapped_area_ha: s.mapped_area_ha ?? null,
        farms_contributing: s.farms_contributing ?? null, shared_records: s.shared_records ?? null, suppressed: s.suppressed || [], k: s.k ?? G.K },
    };
  }

  const lines = (draft) => draft.sections.flatMap((s) => s.lines);
  // Every source the draft's lines still carry, once each.
  function inputs(draft) {
    const seen = new Map();
    for (const l of lines(draft)) for (const s of l.sources || []) {
      const key = s.kind + ":" + (s.id ?? [s.site_id, s.parameter, s.sampled_at].join("|") ?? s.period);
      if (!seen.has(key)) seen.set(key, s);
    }
    return [...seen.values()];
  }
  // The facilitator's edits: change a line's text, remove it, or add their own (no sources: it says it is theirs).
  function edit(draft, id, text) {
    for (const l of lines(draft)) if (l.id === id) { if (l.text !== text) { l.text = text; l.edited = true; } return true; }
    return false;
  }
  function remove(draft, id) {
    for (const s of draft.sections) { const i = s.lines.findIndex((l) => l.id === id); if (i >= 0) { s.lines.splice(i, 1); return true; } }
    return false;
  }
  function add(draft, sectionKey, text) {
    const s = draft.sections.find((x) => x.key === sectionKey) || draft.sections[draft.sections.length - 1];
    const line = { id: lineId(), text: String(text || ""), sources: [], own: true };
    s.lines.push(line);
    return line;
  }
  // Save-time check (the reads are done again by the caller): a line is stale when any of its revocable sources is no
  // longer delivered, or when a shared record is no longer attributed as the draft attributed it (its farm's level was
  // lowered: no ref now, another ref, or no longer named). live: { entry: Set, document: Set } of own ids readable now;
  // { shared_entry: Map, shared_document: Map } of id -> farm ref (or null) as delivered now; members: group_member_farms now.
  function recheck(draft, live) {
    const stale = [], members = live?.members || [];
    const has = (s) => { const v = live?.[s.kind]; return v instanceof Set || v instanceof Map ? v.has(s.id) : false; };
    const moved = (s) => {
      if (!["shared_entry", "shared_document"].includes(s.kind) || !(live?.[s.kind] instanceof Map)) return false;
      const ref = live[s.kind].get(s.id) || null;
      if ((s.farm || null) !== ref) return true;
      return !!s.name && members.find((m) => m.farm_ref === ref)?.name !== s.name;
    };
    for (const l of lines(draft)) {
      const gone = (l.sources || []).filter((s) => REVOCABLE.includes(s.kind) && (!has(s) || moved(s)));
      if (gone.length) stale.push({ id: l.id, text: l.text, gone });
    }
    return stale;
  }
  // The manifest: what the stored document was made from, and the sharing at the time.
  function manifest(draft, { savedAt, savedBy } = {}) {
    return { schema: SCHEMA, model: MODEL, version: VERSION, group: draft.group, period: { key: draft.period.key, from: draft.period.from, to: draft.period.to, label: draft.period.label },
      member_detail_at_the_time: draft.group.member_detail, assembled_at: draft.assembled_at, assembled_by: draft.assembled_by,
      saved_at: savedAt || null, saved_by: savedBy || null, summary: draft.summary, inputs: inputs(draft),
      lines: lines(draft).map((l) => ({ id: l.id, sources: (l.sources || []).length, edited: !!l.edited, own: !!l.own })), ai: null };
  }

  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const sourceText = (s) => s.kind === "result" ? "monitoring result, site " + s.site_id + ", " + s.parameter + ", " + G.shortDate(s.sampled_at) + " (" + s.source_key + ")"
    : s.kind === "summary" ? "member summary for " + s.period
    : ({ entry: "group record", shared_entry: "record shared by a member farm", document: "group document", shared_document: "document shared by a member farm" }[s.kind] || s.kind) + " " + String(s.id).slice(0, 8);
  function sharingNote(draft, savedAt) {
    const when = G.shortDate(savedAt || draft.assembled_at);
    return "This update includes only records the group could read on " + when + ": its own records and what member farms had shared with " +
      (draft.group.name || "the group") + ". Member farms were shown " + (G.LEVEL_TEXT[draft.group.member_detail] || G.LEVEL_TEXT.aggregated).split(" — ")[0].toLowerCase() +
      " (the group's setting at the time); figures from fewer than " + (draft.summary.k || G.K) + " farms are not shown. If a farm later stops sharing, " +
      "this stored update is not changed, and the farm's records are left out of future updates.";
  }
  // One self-contained HTML document: readable on its own, printable, with its manifest inside the file that is hashed.
  function render(draft, { savedAt, savedBy, author } = {}) {
    const m = manifest(draft, { savedAt, savedBy });
    const json = JSON.stringify(m).replace(/</g, "\\u003c");
    const body = draft.sections.map((s) => "<section><h2>" + esc(s.heading) + "</h2><ul>" + s.lines.map((l) => "<li>" + esc(l.text) +
      ((l.sources || []).length ? "<small>Sources: " + l.sources.map((x) => esc(sourceText(x))).join("; ") + "</small>" : l.own ? "<small>Added by the facilitator.</small>" : "") + "</li>").join("") + "</ul></section>").join("");
    return "<!doctype html><html lang=\"en-NZ\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
      "<title>" + esc(draft.title) + "</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:46rem;margin:2rem auto;padding:0 1rem;color:#1b1b1b;background:#fff}" +
      "h1{font-size:1.5rem}h2{font-size:1.15rem;margin-top:1.5rem}li{margin:.4rem 0}small{display:block;color:#555;font-size:.8rem}footer{margin-top:2rem;border-top:1px solid #ccc;padding-top:1rem;font-size:.9rem;color:#333}</style></head><body>" +
      "<h1>" + esc(draft.title) + "</h1><p>" + esc(draft.period.start) + " to " + esc(draft.period.end) + (author ? " · prepared by " + esc(author) : "") + "</p>" + body +
      "<footer><h2>Sources and sharing</h2><p>" + esc(sharingNote(draft, savedAt)) + "</p><p>Drafted by code from the period's records (" + esc(MODEL) + " " + VERSION + "), edited by a person. No AI was used.</p></footer>" +
      "<script type=\"application/json\" id=\"group-update-manifest\">" + json + "</script></body></html>";
  }
  // The manifest back out of a stored file (for tests and for reading an update later).
  function readManifest(html) {
    const m = String(html).match(/<script type="application\/json" id="group-update-manifest">([\s\S]*?)<\/script>/);
    return m ? JSON.parse(m[1]) : null;
  }
  // The documents row a saved update is registered with (owned by the group; org-internal: its members only).
  // A person saved it as the group's main document, so its tier is chosen (tiered_at), as a person's choice is in B3.
  function documentRow(draft, { sha256, path, size, author, savedAt }) {
    return { org_id: draft.group.id, title: draft.title, doc_type: "group_update", original_name: "monthly-update-" + draft.period.key + ".html", mime_type: "text/html",
      sha256, size_bytes: size, storage_path: path, period_start: draft.period.start, period_end: draft.period.end, date_prepared: G.isoDay(Date.now()),
      author: author || null, author_org: draft.group.name || null, model: MODEL, model_version: VERSION, status: "final", purpose: "group_update", tier: "primary", tiered_at: savedAt || new Date().toISOString(), visibility: "farm" };
  }
  return { SCHEMA, MODEL, VERSION, assemble, inputs, edit, remove, add, recheck, manifest, render, readManifest, documentRow, sharingNote, lines };
});
