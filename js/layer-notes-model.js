// Advisor layer notes (LN1): what advisors wrote about each layer, in the shapes the app shows. No DOM, network or clock.
// A note (public.layer_notes) is about one layer (a reference source by source_key, or an owned layer by map_layer_id)
// at one scope: global (RCL), group (an organisation) or farm. The narrowest applies: on the map each part of the note
// comes from the narrowest note that says something about it (farm, then group, then global). The Operations "Layers"
// page lists every layer with its note's status at the scope being edited.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api; else root.FP.layerNotes = api;
})(typeof window === "undefined" ? globalThis : window, function () {
  const FIELDS = [
    ["what_it_is", "What it is", "Only where the layer's name doesn't say."],
    ["useful_for", "Useful for", "A guide, not a full list."],
    ["caveats", "Caveats and red herrings", "Where it misleads, or is read wrongly."],
    ["show_to_group", "When to show a catchment group", "Which meeting, question or stage it belongs to."],
    ["notes", "Notes", "Anything else that refines what is shown, or what it is good for in analysis."],
  ];
  const MAX = { what_it_is: 2000, useful_for: 2000, caveats: 2000, show_to_group: 2000, notes: 4000 };
  const RANK = { farm: 0, group: 1, global: 2 };
  const SCOPE_WORD = { global: "RCL", group: "the group", farm: "this farm" };
  const text = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const isEmpty = (n) => !n || FIELDS.every(([k]) => !text(n[k]));
  // A layer's key in the app: "source:<key>" or "layer:<id>".
  const keyOf = (n) => (n?.source_key ? "source:" + n.source_key : n?.map_layer_id ? "layer:" + String(n.map_layer_id).toLowerCase() : null);
  const ofLayer = (notes, key) => (Array.isArray(notes) ? notes : []).filter((n) => n && keyOf(n) === key && RANK[n.scope] != null);

  // The note the map shows for one layer: each part from the narrowest note that has it. Null when nothing is written.
  function applicable(notes, key) {
    const mine = ofLayer(notes, key).sort((a, b) => RANK[a.scope] - RANK[b.scope]);
    const parts = FIELDS.map(([k, label]) => {
      const from = mine.find((n) => text(n[k]));
      return from ? { key: k, label, text: text(from[k]), scope: from.scope, from: SCOPE_WORD[from.scope] } : null;
    }).filter(Boolean);
    if (!parts.length) return null;
    const scopes = [...new Set(parts.map((p) => p.scope))].sort((a, b) => RANK[a] - RANK[b]);
    const latest = mine.filter((n) => !isEmpty(n)).map((n) => n.updated_at).filter((t) => Number.isFinite(Date.parse(t))).sort().pop() || null;
    return { parts, scopes, updated_at: latest, narrowed: scopes.some((s) => s !== "global") };
  }

  // Every layer the Operations page lists: the reference sources, then the organisations' own layers.
  // scope: { scope: "global" } | { scope: "group", org_id } | { scope: "farm", farm_id } — the note being edited.
  function catalogue(sources, layers, notes, scope) {
    const s = scope || { scope: "global" };
    const at = (n) => n.scope === s.scope && (s.scope === "global" || (s.scope === "group" ? n.org_id === s.org_id : n.farm_id === s.farm_id));
    const rows = [];
    for (const r of Array.isArray(sources) ? sources : []) {
      if (!r?.key) continue;
      rows.push({ key: "source:" + r.key, kind: "reference", source_key: r.key, name: r.name || r.key, theme: r.theme || null, provider: r.provider || null,
        what: r.summary || null, served: r.serve_to_customers !== false });
    }
    for (const l of Array.isArray(layers) ? layers : []) {
      if (!l?.id) continue;
      rows.push({ key: "layer:" + String(l.id).toLowerCase(), kind: "owned", map_layer_id: l.id, org_id: l.org_id || null, farm_id: l.farm_id || null,
        name: l.name || "Layer", theme: l.theme || null, provider: l.owner_name || null, what: null, served: true });
    }
    for (const row of rows) {
      const all = ofLayer(notes, row.key), here = all.find(at) || null;
      // an owned layer's note is its owner's: it is edited only at that scope
      row.editable = row.kind === "reference" ? true : s.scope === "group" ? row.org_id === s.org_id : s.scope === "farm" ? row.farm_id === s.farm_id : false;
      row.note = here;
      row.status = here && !isEmpty(here) ? "drafted" : "empty";
      row.others = all.filter((n) => n !== here && !isEmpty(n)).map((n) => n.scope);
    }
    return rows;
  }

  // Search (name, key, theme, provider, the note's own words) and the status filter ("all", "empty", "drafted").
  function filter(rows, { q = "", status = "all" } = {}) {
    const words = String(q || "").toLowerCase().split(/\s+/).filter(Boolean);
    return (Array.isArray(rows) ? rows : []).filter((r) => (status === "all" || r.status === status) && words.every((w) =>
      [r.name, r.source_key, r.theme, r.provider, ...FIELDS.map(([k]) => r.note?.[k])].some((v) => String(v || "").toLowerCase().includes(w))));
  }

  // The sentence at the top of the page.
  function summary(rows) {
    const list = Array.isArray(rows) ? rows : [], drafted = list.filter((r) => r.status === "drafted").length;
    if (!list.length) return { text: "No layers are recorded yet", because: "reference sources appear here once they are registered" };
    return { text: drafted + " of " + list.length + " layers have a note", because: drafted === list.length ? "every layer is drafted" :
      (list.length - drafted) + " still empty" + (list.find((r) => r.status === "empty") ? ", the first " + list.find((r) => r.status === "empty").name : "") };
  }

  // What a save writes: the five parts, trimmed, blank as null; refused when one is too long.
  function draft(values) {
    const out = {}, errors = [];
    for (const [k, label] of FIELDS) {
      const v = text(values?.[k]);
      if (v && v.length > MAX[k]) errors.push(label + " is longer than " + MAX[k] + " characters.");
      out[k] = v;
    }
    return { values: out, errors, empty: FIELDS.every(([k]) => !out[k]) };
  }

  return { FIELDS, MAX, SCOPE_WORD, isEmpty, keyOf, applicable, catalogue, filter, summary, draft };
});
