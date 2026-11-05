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
  const SCOPE_NAME = { global: "RCL's", group: "The group's", farm: "This farm's" };

  // Who may write at each scope (the roles row-level security on layer_notes checks): RCL staff write RCL's global note, an
  // organisation's facilitators, advisors and admins its group note, a farm's editors, admins and owners its farm note. The
  // farm rule is the one FP.farmModel.canEdit reads (a viewer is never offered an editor).
  const ORG_WRITERS = ["facilitator", "advisor", "admin"], FARM_WRITERS = ["owner", "admin", "edit"];
  const mayWriteOrg = (role) => ORG_WRITERS.includes(role), mayWriteFarm = (role) => FARM_WRITERS.includes(role);
  // The scopes this person is offered, from the roles the app already reads: { staff, orgs: [{ id, name, role }], farms: [...] }.
  // Only scopes they may write; nothing at all for a viewer or a group member.
  function writableScopes({ staff = false, orgs = [], farms = [] } = {}) {
    const out = [];
    if (staff === true) out.push({ value: "global", label: "RCL — global note", scope: { scope: "global" } });
    const named = (list, fallback) => (Array.isArray(list) ? list : []).map((x) => ({ ...x, name: x.name || fallback })).sort((a, b) => String(a.name).localeCompare(String(b.name)));
    for (const o of named(orgs, "Organisation")) if (o.id && mayWriteOrg(o.role)) out.push({ value: "group:" + o.id, label: o.name + " — group note", scope: { scope: "group", org_id: o.id } });
    for (const f of named(farms, "Farm")) if (f.id && mayWriteFarm(f.role)) out.push({ value: "farm:" + f.id, label: f.name + " — farm note", scope: { scope: "farm", farm_id: f.id } });
    return out;
  }
  // Whether the farm space offers the notes screen: the person edits this farm, or advises the organisation that services it.
  const offersNotes = ({ farmRole, orgRole } = {}) => mayWriteFarm(farmRole) || mayWriteOrg(orgRole);

  // Who wrote a note, as far as the app knows without asking who a person is: you, or the capacity the scope means.
  const CAPACITY = { global: "RCL staff", group: "an advisor of the group", farm: "an editor of this farm" };
  const day = (ts) => (Number.isFinite(Date.parse(ts)) ? new Date(ts).toLocaleDateString("en-NZ", { timeZone: "Pacific/Auckland", day: "numeric", month: "short", year: "numeric" }) : null);
  function byline(n, me) {
    if (!n || RANK[n.scope] == null) return null;
    const who = me && n.updated_by && n.updated_by === me ? "you (" + CAPACITY[n.scope] + ")" : CAPACITY[n.scope], when = day(n.updated_at);
    return { scope: n.scope, who, when, text: SCOPE_NAME[n.scope] + " note by " + who + (when ? ", " + when : "") };
  }
  const text = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const isEmpty = (n) => !n || FIELDS.every(([k]) => !text(n[k]));
  // A layer's key in the app: "source:<key>" or "layer:<id>".
  const keyOf = (n) => (n?.source_key ? "source:" + n.source_key : n?.map_layer_id ? "layer:" + String(n.map_layer_id).toLowerCase() : null);
  const ofLayer = (notes, key) => (Array.isArray(notes) ? notes : []).filter((n) => n && keyOf(n) === key && RANK[n.scope] != null);

  // The note the map shows for one layer: each part from the narrowest note that has it. Null when nothing is written.
  function applicable(notes, key, me) {
    const mine = ofLayer(notes, key).sort((a, b) => RANK[a.scope] - RANK[b.scope]);
    const parts = FIELDS.map(([k, label]) => {
      const from = mine.find((n) => text(n[k]));
      return from ? { key: k, label, text: text(from[k]), scope: from.scope, from: SCOPE_WORD[from.scope] } : null;
    }).filter(Boolean);
    if (!parts.length) return null;
    const scopes = [...new Set(parts.map((p) => p.scope))].sort((a, b) => RANK[a] - RANK[b]);
    const latest = mine.filter((n) => !isEmpty(n)).map((n) => n.updated_at).filter((t) => Number.isFinite(Date.parse(t))).sort().pop() || null;
    // who wrote the notes the parts came from, narrowest first
    const by = scopes.map((sc) => byline(mine.find((n) => n.scope === sc), me)).filter(Boolean);
    return { parts, scopes, by, updated_at: latest, narrowed: scopes.some((s) => s !== "global") };
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

  return { FIELDS, MAX, SCOPE_WORD, ORG_WRITERS, FARM_WRITERS, writableScopes, offersNotes, byline, isEmpty, keyOf, applicable, catalogue, filter, summary, draft };
});
