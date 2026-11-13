// The catchment group's standing water-quality answer (MC1, docs/CATCHMENT-SPACE.md "Water quality: the group's answer"):
// "What does our water-quality data tell us, compared with ECan's sites?", written by code, never by a model. The figures
// are the analysis library's (X1, supabase/functions/_shared/wq), computed now as the signed-in person by the `analysis`
// function in preview mode (nothing is stored), under the group's published method (X1b preset, e.g. hdlg-nitrate-band):
// the group's own sites (D2) and ECan's sites in the group's area, the same parameter and window; for each, n, the median
// (with censoring bounds), the NPS-FM band only where the preset's method yields one (else "not assessed" and why), the
// library's caveats, LAWA's state and trend where ECan's site is matched to a LAWA site (D3), and the sources of every line.
// Nothing here calculates a statistic: this file picks the sites and the requests, and words what came back.
// Sites (WQ3): the group's own come from group_wq_sites (S5's list, the one B8's chart uses); ECan's come from group_wq_pick,
// not from "the nearest": the ECan sites in the group's area (the preset's area) that are active and have a long record of the
// answer's parameter family (at least 40 sampling times in the last 5 years), LAWA-matched first, then the longer record. A site
// that belongs to a monitoring location (WQ2) is one line, named for the location and labelled with its current site's id, and
// its combined record is what is analysed. A farm's own site is never in the group's answer, even when the person can read it as
// a member of that farm: S5's member levels and k = 3 are not touched. WQ7 (Q20 default): where the group's hydrological rank is
// on, the pick lists ECan's sites on a river reach downstream of member land first and says which rule placed each site
// (placed_by: "downstream of member land" / "in the group's area", with the reach distance); each line says it. A pick without
// placed_by (the database before WQ7) is worded as before. Pure, apart from build(), which makes the reads through the client it
// is given.
(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const api = factory(node ? require("./wq-analysis.js") : root.FP.wqAnalysis);
  if (node) module.exports = api; else root.FP.groupWqAnswer = api;
})(typeof window === "undefined" ? globalThis : window, function (W) {
  // PH2: a name's possessive, as wq-model.js possessive: "Ashburton Lakes'", "MCCC's"
  const whose = (n) => (/s$/i.test(String(n)) ? n + "'" : n + "'s");
  const QUESTION = "What does our water-quality data tell us, compared with ECan's sites?";
  const MAX_OWN = 4, MAX_REFERENCE = 4, CONCURRENCY = 4;
  // A shared site list and the results dataset measured at its sites (the D2 rule: an owned site's list is its own dataset).
  const REFERENCE = { "ecan-wq-sites": { dataset: "ecan-wq", who: "ECan" } };
  // An attribute's parameter, and the fallback the library itself uses for nitrate toxicity (nitrate-nitrite-N, as LAWA).
  const ATTRIBUTES = {
    "nitrate-toxicity": { name: "Nitrate (toxicity)", parameters: ["nitrate-n", "nitrate-nitrite-n"] },
    "e-coli": { name: "E. coli", parameters: ["e-coli"] },
    drp: { name: "Dissolved reactive phosphorus", parameters: ["drp"] },
    "suspended-fine-sediment": { name: "Suspended fine sediment", parameters: ["clarity"] },
  };
  const PARAMETER = { "nitrate-n": "nitrate-N", "nitrate-nitrite-n": "nitrate-nitrite-N (total oxidised nitrogen)", "e-coli": "E. coli", drp: "dissolved reactive phosphorus", clarity: "visual clarity" };
  // LAWA's indicator names for a parameter (its workbook's own words, e.g. "Nitrate nitrogen", "NO3N").
  const LAWA_INDICATOR = { "nitrate-n": /nitrate|no3/i, "nitrate-nitrite-n": /nitrate|no3/i, "e-coli": /e\.?\s*coli/i, drp: /\bdrp\b|dissolved reactive/i, clarity: /clarity|bdisc/i };
  const list = (v) => (Array.isArray(v) ? v : []);
  const str = (v) => typeof v === "string" && v.trim() !== "";
  const obj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const day = (d) => (str(d) && /^\d{4}-\d{2}-\d{2}/.test(d) ? Number(d.slice(8, 10)) + " " + MONTHS[Number(d.slice(5, 7)) - 1] + " " + d.slice(0, 4) : "");
  const plural = (n, one, many) => n + " " + (n === 1 ? one : many);
  const dedupe = (xs) => [...new Set(xs.filter(str))];

  // ---- what to ask -------------------------------------------------------------------------------------------------
  // The group's method for this answer: the first published band preset (by family) whose attribute this answer knows;
  // a group with none gets no answer (the empty state says how one is published). Rows: public.group_wq_presets(g).
  function pickPreset(rows) {
    const p = list(rows).find((r) => obj(r) && str(r.preset_id) && obj(r.definition) && r.definition.tool === "band" && ATTRIBUTES[r.definition.parameters?.attribute]);
    return p ? { id: p.preset_id, family: String(p.family || p.definition.family), version: Number(p.version), title: String(p.title || p.definition.title || ""), definition: p.definition } : null;
  }
  // The sites in the answer. The group's own: rows of group_wq_sites whose owner is this group, in its order. ECan's: the rows of
  // group_wq_pick (WQ3), already in the pick's order (LAWA-matched, then the longer record, then the id: never distance), of a
  // known shared list only; a row for a monitoring location carries the location and is labelled with its current site. A farm's
  // site, or another organisation's, is never included; ECan rows of group_wq_sites are not read here.
  // WQ7: the rule that placed a pick row, when the pick says (placed_by); null for the pick's older shape or a value it does not know.
  const PLACED = { "downstream of member land": "downstream", "in the group's area": "area" };
  const placedOf = (r) => {
    const rule = PLACED[r.placed_by];
    if (!rule) return null;
    const km = r.downstream_km !== null && r.downstream_km !== undefined && Number.isFinite(Number(r.downstream_km)) ? Number(r.downstream_km) : null;
    return { rule, words: r.placed_by, km: rule === "downstream" ? km : null };
  };
  function pickSites(rows, groupId, picks = []) {
    const own = [], reference = [];
    const named = (r) => ({ id: Number(r.site_id), name: str(r.name) ? r.name : "Site " + r.external_id, external_id: String(r.external_id ?? ""), source_key: String(r.source_key ?? "") });
    const count = (v) => (v !== null && v !== undefined && Number.isFinite(Number(v)) ? Number(v) : null);
    for (const r of list(rows)) {
      if (!obj(r) || !Number.isInteger(Number(r.site_id))) continue;
      if (!r.owner_farm_id && r.owner_org_id && r.owner_org_id === groupId) { const site = named(r); own.push({ ...site, role: "own", dataset: site.source_key }); }
    }
    for (const r of list(picks)) {
      if (!obj(r) || !Number.isInteger(Number(r.site_id)) || r.owner_farm_id || r.owner_org_id || !REFERENCE[String(r.source_key ?? "")]) continue;
      const site = named(r), ref = REFERENCE[site.source_key];
      const location = Number.isInteger(Number(r.location_id)) && str(r.location_name) ? { id: Number(r.location_id), key: str(r.location_key) ? r.location_key : null, name: r.location_name } : null;
      reference.push({ ...site, role: "reference", dataset: ref.dataset, who: ref.who, location,
        record: { n: count(r.n), years: count(r.years), n_last_5y: count(r.n_last_5y), lawa_matched: r.lawa_matched === true }, placed: placedOf(r) });
    }
    return { own: own.slice(0, MAX_OWN), reference: reference.slice(0, MAX_REFERENCE), more: Math.max(own.length - MAX_OWN, 0) + Math.max(reference.length - MAX_REFERENCE, 0) };
  }
  // What the pick asks for: the answer's parameter (its family finds the sites that have either key) and the preset's area.
  const pickArgs = (groupId, preset) => ({ g: groupId, p_parameter: ATTRIBUTES[preset.definition.parameters.attribute].parameters[0],
    p_area: str(preset.definition.applies_to?.area) ? preset.definition.applies_to.area : null });
  // The analysis function's preview requests (POST /functions/v1/analysis; nothing is stored). The band names the preset, so
  // the library takes its tool and settings and refuses a site it does not apply to; the summary is the same parameter and
  // window (the preset's end year, 5 hydrological years, as the band).
  // A site in a monitoring location is analysed as the location (WQ2: its members' results, each within its dates, labelled with
  // its current site); any other site as itself.
  const subject = (site) => (site.location ? { location_id: site.location.id } : { site_id: site.id });
  const bandRequest = (groupId, preset, site) => ({ mode: "preview", owner: { org_id: groupId }, params: subject(site), preset_id: preset.id });
  const summaryRequest = (groupId, site, parameter, endYear) => ({ mode: "preview", owner: { org_id: groupId },
    params: { tool: "summary", ...subject(site), parameter, years: 5, ...(Number.isInteger(endYear) ? { end_year: endYear } : {}) } });
  // Why the preset's method gives no band at a site before anything is asked: it bands one dataset and this site's results
  // are another (the group's own sampling against ECan's record, say). The library would only say "no results".
  function bandSkipped(preset, site, groupName) {
    const ds = preset.definition.parameters?.dataset;
    if (!ds || ds === site.dataset) return null;
    return whose(groupName || "The group") + " method (" + preset.family + " v" + preset.version + ") bands the " + ds + " record only; this site's results are " +
      (site.role === "own" ? "the group's own sampling (" + site.dataset + ")" : "another dataset (" + site.dataset + ")") + ", so they are summarised here but not banded.";
  }

  // ---- reading the answers -------------------------------------------------------------------------------------------
  // LAWA's results for one ECan site (rows of public.wq_state_trend_for_site), for one parameter: the state rows (LAWA's own
  // band) and trend rows of the matching indicator. Nothing is calculated: LAWA's words, period, release and row.
  function lawaOf(rows, parameter) {
    const want = LAWA_INDICATOR[parameter];
    const mine = list(rows).filter((r) => obj(r) && want && want.test(String(r.indicator || "")));
    if (!mine.length) return null;
    const first = mine[0];
    return {
      lawa_site_id: String(first.lawa_site_id || ""), release: str(first.release) ? first.release : null, file: str(first.file_name) ? first.file_name : null,
      attribution: str(first.attribution) ? first.attribution : null, match_method: str(first.match_method) ? first.match_method : null, source_key: first.source_key || "lawa-river-wq",
      state: mine.filter((r) => r.kind === "state" && str(r.state)).map((r) => ({ attribute: r.attribute || r.indicator, band: r.state, period: r.period || null, sheet: r.sheet || null, row: r.source_row ?? null })),
      trend: mine.filter((r) => r.kind === "trend" && str(r.trend_description)).map((r) => ({ indicator: r.indicator, description: r.trend_description, period: r.period || null, sheet: r.sheet || null, row: r.source_row ?? null })),
    };
  }

  // A monitoring location's members as the function recorded them in the preview (WQ2's `location`): role, dates, samples.
  const ROLE_WORDS = { current: "current", successor: "successor", predecessor: "predecessor", co_located: "co-located" };
  const memberOf = (m) => ({ external_id: String(m.external_id), role: ROLE_WORDS[m.role] || String(m.role || ""), from: str(m.valid_from) ? m.valid_from : null,
    to: str(m.valid_to) ? m.valid_to : null, samples: m.samples !== null && m.samples !== undefined && Number.isFinite(Number(m.samples)) ? Number(m.samples) : null });
  const memberText = (m) => m.external_id + " (" + [m.role, m.from ? "from " + day(m.from) : "", m.to ? "to " + day(m.to) : "", m.samples !== null ? plural(m.samples, "sample", "samples") : ""].filter(Boolean).join(", ") + ")";

  // One line of the answer from what the function and LAWA returned for one site. band/summary: {kind, preview|message}.
  function line(site, { band = null, skipped = null, summary = null, lawa = null, lawaError = false, preset = null, groupName = "" } = {}) {
    const s = summary?.preview || null, b = band?.preview || null, r = s?.result || null;
    const unit = r?.unit || "";
    const parameter = s?.parameters?.parameter || b?.parameters?.parameter || null;
    const out = { id: "site-" + site.id, site: { id: site.id, name: site.name, external_id: site.external_id, source_key: site.source_key }, role: site.role, parameter,
      window: s?.parameters?.from ? { from: s.parameters.from, to: s.parameters.to } : b?.parameters?.from ? { from: b.parameters.from, to: b.parameters.to } : null,
      location: null, record: site.record || null, placed: site.placed || null, dataset: null, summary: null, summary_note: null, band: null, not_assessed: null, lawa: null, lawa_note: null, caveats: [], sources: [], error: null };
    // WQ3/WQ2: a monitoring location is named for the location and labelled with its current site's id (the site on this line); its
    // members and their dates are as the function recorded them in the preview
    if (site.location) out.location = { id: site.location.id, key: site.location.key, name: site.location.name, current: site.external_id,
      members: list((s?.location || b?.location)?.members).filter((m) => obj(m) && str(m.external_id)).map(memberOf) };
    const att = list(s?.attribution)[0] || list(b?.attribution)[0] || null;
    out.dataset = { key: att?.dataset || site.dataset, name: att?.name || site.dataset, statement: att?.statement || null, provisional: att?.provisional || null,
      owner: site.role === "own" ? "the group's own data" : "shared reference data (" + (site.who || site.source_key) + ")" };
    // n and the median, from the summary (every sample in the window, replicates collapsed; censored values as bounds)
    if (s && !s.unavailable && r && Number.isFinite(r.samples)) out.summary = { n: r.samples, below: r.censored_below || 0, above: r.censored_above || 0, median: W.range(r.median, unit), unit };
    else if (s?.unavailable) out.summary_note = s.unavailable.detail;
    else if (summary?.message) out.error = summary.message;
    // the band, only where the preset's method yields one
    if (b && !b.unavailable && b.result?.band) {
      out.band = { band: String(b.result.band), monthly_values: b.result.monthly_values ?? null, table: b.method?.table || null, method: b.method?.id || null,
        // a band preview asked for by preset_id is the preset's (a site it does not apply to comes back unavailable)
        preset: preset ? whose(groupName || "the group") + " method " + preset.family + " v" + preset.version : null };
    } else out.not_assessed = skipped || (b?.unavailable ? b.unavailable.detail : band?.message ? "the analysis couldn't be run: " + band.message : "no result from the group's method.");
    // LAWA (D3): ECan's site matched to a LAWA site
    if (site.role === "reference") {
      if (lawa && (lawa.state.length || lawa.trend.length)) out.lawa = lawa;
      else out.lawa_note = lawaError ? "LAWA's state and trend couldn't be read." : "LAWA reports no state or trend for this site (it is not matched to a LAWA site, or LAWA has no " + (PARAMETER[parameter] || "result") + " here).";
    }
    out.caveats = dedupe([...list(s?.caveats), ...list(b?.caveats)]);
    // sources: the dataset rows read (with the latest change), the method, LAWA's release and rows
    for (const p of [s, b].filter(Boolean)) {
      for (const k of list(p.measurement_sources)) {
        const v = p.source_versions?.[k] || {};
        out.sources.push({ kind: "measurements", dataset: k, site: site.source_key + " " + site.external_id, rows: v.rows ?? null, as_at: v.max_updated_at ? String(v.max_updated_at).slice(0, 10) : null, method: p.method?.id || null,
          preview: String(p.preview_sha256 || "").slice(0, 12) });
      }
    }
    if (!out.sources.length) out.sources.push({ kind: "site", dataset: out.dataset.key, site: site.source_key + " " + site.external_id });
    if (out.location) out.sources.push({ kind: "location", location: out.location.name, current: out.location.current, members: out.location.members.map(memberText).join(", ") });
    if (out.lawa) for (const x of [...out.lawa.state, ...out.lawa.trend]) out.sources.push({ kind: "lawa", source_key: out.lawa.source_key, lawa_site_id: out.lawa.lawa_site_id, release: out.lawa.release, sheet: x.sheet, row: x.row });
    return out;
  }

  // ---- words ----------------------------------------------------------------------------------------------------------
  function sourceText(x) {
    if (x.kind === "measurements") return x.dataset + " at " + x.site + (x.rows !== null ? ", " + plural(x.rows, "result", "results") + " read" : "") + (x.as_at ? " (latest change " + day(x.as_at) + ")" : "") + (x.method ? ", " + x.method : "") + (x.preview ? ", preview " + x.preview : "");
    if (x.kind === "location") return "monitoring location " + x.location + ", labelled with its current site " + x.current + (x.members ? "; combined record of " + x.members : "");
    if (x.kind === "lawa") return "LAWA " + x.lawa_site_id + (x.release ? ", release " + x.release : "") + (x.sheet ? ", " + x.sheet + (x.row !== null ? " row " + x.row : "") : "");
    return x.dataset + " at " + x.site;
  }
  const bandText = (l) => (l.band ? "NPS-FM band " + l.band.band + (l.band.table ? " (" + l.band.table + ")" : "") + (l.band.preset ? " by " + l.band.preset : "") + (l.band.monthly_values ? ", " + l.band.monthly_values + " monthly values" : "")
    : "Band not assessed: " + l.not_assessed.replace(/\.$/, ""));
  const lawaText = (l) => !l.lawa ? l.lawa_note : "LAWA" + (l.lawa.release ? " (release " + l.lawa.release + ")" : "") + ": " +
    [...l.lawa.state.map((x) => x.attribute + " band " + x.band + (x.period ? " (" + x.period + ")" : "")), ...l.lawa.trend.map((x) => x.indicator + " trend " + (x.period ? "over " + x.period : "") + ": " + x.description)].join("; ") +
    (l.lawa.attribution ? ". " + l.lawa.attribution.replace(/\.$/, "") : "") + ".";
  const figures = (l) => (l.summary ? plural(l.summary.n, "sample", "samples") + (l.summary.below || l.summary.above ? " (" + [l.summary.below ? l.summary.below + " below" : "", l.summary.above ? l.summary.above + " above" : ""].filter(Boolean).join(", ") + " a detection limit)" : "") + ", median " + l.summary.median
    : l.error ? "couldn't be calculated: " + l.error : "no results: " + (l.summary_note || "none in the window").replace(/\.$/, ""));
  // WQ7: which rule placed an ECan site in the answer, as a short tag and as a sentence (null: the pick did not say).
  const placedTag = (l) => (l.placed ? l.placed.words : null);
  const placedText = (l) => !l.placed ? null : l.placed.rule === "downstream"
    ? "Placed by the rule \"downstream of member land\": on a river reach (REC2) below the group's member blocks" + (l.placed.km !== null ? ", " + l.placed.km.toFixed(1) + " km down the river from member land" : "") + "."
    : "Placed by the rule \"in the group's area\": inside the group's area.";
  // A line as the Answer block's item: the site; a short reason (figures, band, source, the rule that placed it); the whole line behind All.
  function item(l) {
    const who = l.role === "own" ? "the group's own site" : "ECan site";
    const text = l.location ? l.location.name + " (" + who + " " + l.location.current + ")" : l.site.name + " (" + who + ")";
    const because = figures(l) + "; " + (l.band ? "band " + l.band.band : "not banded") + " · source " + l.dataset.key + (placedTag(l) ? " · " + placedTag(l) : "");
    const detail = [l.site.source_key + " " + l.site.external_id + ", " + l.dataset.name + " (" + l.dataset.key + "), " + l.dataset.owner + ".", placedText(l),
      l.location ? "Monitoring location " + l.location.name + ", labelled with its current site " + l.location.current +
        (l.location.members.length ? ": the combined record of " + l.location.members.map(memberText).join(", ") + ". Each site's results count only within its dates." : ".") : null,
      (l.parameter ? (PARAMETER[l.parameter] || l.parameter) + (l.window ? ", " + day(l.window.from) + " to " + day(l.window.to) : "") + ": " : "") + figures(l) + ".",
      bandText(l) + ".", l.role === "reference" ? lawaText(l) : null,
      l.caveats.length ? "Caveats: " + l.caveats.map((c) => c.replace(/\.$/, "")).join("; ") + "." : null,
      "Sources: " + l.sources.map(sourceText).join("; ") + "."].filter(Boolean).join(" ");
    return { id: l.id, text, because, detail, eligible: true, role: l.role };
  }

  // The Answer block's model (app/js/blocks/answer.js) for the whole answer. r: what build() returned.
  function answer(r) {
    const base = { key: "group-wq", title: QUESTION, rank: "given", allLabel: "Every site, in full", items: [] };
    if (!r || r.state === "no_preset") return { ...base, empty: { text: "No water-quality method is published for this group yet. When the group's advisor publishes one (an analysis preset), this answer is written from it, by code, for the group's own sites and ECan's." } };
    if (r.state === "no_sites") return { ...base, empty: { text: "Neither the group's own monitoring sites nor ECan's active long-term sites (a current record of this parameter, at least 40 samples in the last 5 years) are recorded in the group's area, so there is nothing to compare yet." } };
    if (r.state === "unavailable") return { ...base, empty: { text: "The water-quality analysis couldn't be run just now: " + (r.message || W.UNAVAILABLE) } };
    const lines = list(r.lines), own = lines.filter((l) => l.role === "own"), ref = lines.filter((l) => l.role === "reference");
    const attr = ATTRIBUTES[r.preset.definition.parameters.attribute], w = lines.find((l) => l.window)?.window;
    const banded = lines.filter((l) => l.band), lawa = ref.filter((l) => l.lawa);
    // the group's sites and ECan's side by side (so the lines promoted above All hold both)
    const items = Array.from({ length: Math.max(own.length, ref.length) }, (_, i) => [own[i], ref[i]]).flat().filter(Boolean).map(item);
    const text = attr.name + (w ? ", " + day(w.from) + " to " + day(w.to) : "") + ": " + plural(own.length, "site", "sites") + " of the group's own beside " + plural(ref.length, "ECan site", "ECan sites");
    const because = (banded.length ? "NPS-FM band at " + plural(banded.length, "site", "sites") + " (" + banded.map((l) => l.site.name + " " + l.band.band).join(", ") + ")" : "no site has an NPS-FM band") +
      " by " + whose(r.groupName || "the group") + " method " + r.preset.family + " v" + r.preset.version + "; " + plural(lines.length - banded.length, "site", "sites") + " not assessed, each with the reason" +
      (lawa.length ? "; LAWA's state and trend at " + plural(lawa.length, "ECan site", "ECan sites") : "");
    return { ...base, answer: { text, because }, items, total: items.length,
      currency: "Written by code from the platform's tested water-quality library (" + dedupe(lines.flatMap((l) => l.sources.map((x) => x.method))).join(", ") + ") as you can read it now; nothing is stored and no AI is used. " +
        "Datasets are never pooled. " + "ECan's sites are the active ones in the group's area with a long record of this parameter (at least 40 samples in the last 5 years), " +
        (ref.some((l) => l.placed?.rule === "downstream") ? "those on a river reach downstream of member land first; among them and among the rest, " : "") + "LAWA-matched first, then the longest record; not the nearest. " +
        (r.more ? plural(r.more, "more site", "more sites") + " with such a record are not shown here. " : "") + "The chart below shows the results themselves." };
  }

  // ---- the reads (as the signed-in person) -----------------------------------------------------------------------------
  async function pool(tasks, n) {
    const out = new Array(tasks.length); let next = 0;
    await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, async () => { while (next < tasks.length) { const i = next++; out[i] = await tasks[i](); } }));
    return out;
  }
  // build({sb, group, sites?, presets?, request?}): the group's preset and site list (read here unless given), then for each
  // site the band (preset) and the summary from the analysis function, and LAWA's results for ECan's sites.
  async function build({ sb, group, sites = null, picks = null, presets = null, request = W.request }) {
    const rpc = async (name, args) => { const { data, error } = await sb.rpc(name, args); if (error) throw error; return data || []; };
    const preset = pickPreset(presets ?? await rpc("group_wq_presets", { g: group.id }).catch(() => []));
    if (!preset) return { state: "no_preset" };
    const picked = pickSites(sites ?? await rpc("group_wq_sites", { g: group.id }), group.id, picks ?? await rpc("group_wq_pick", pickArgs(group.id, preset)));
    const all = [...picked.own, ...picked.reference];
    if (!all.length) return { state: "no_sites", preset };
    const attr = ATTRIBUTES[preset.definition.parameters.attribute];
    const lines = await pool(all.map((site) => async () => {
      const skipped = bandSkipped(preset, site, group.name);
      const band = skipped ? null : await request(sb, bandRequest(group.id, preset, site));
      const b = band?.kind === "preview" ? band.preview : null;
      const endYear = Number.isInteger(b?.parameters?.end_year) ? b.parameters.end_year : preset.definition.parameters.end_year;
      // the band's own parameter first (it records the nitrate-nitrite-N fallback when it used it), then the attribute's
      const order = dedupe([b?.parameters?.parameter, ...attr.parameters]);
      let summary = null;
      for (const p of order) {
        summary = await request(sb, summaryRequest(group.id, site, p, endYear));
        if (!(summary.kind === "preview" && summary.preview.unavailable?.reason === "no_results")) break;
      }
      let lawa = null, lawaError = false;
      if (site.role === "reference") {
        try { lawa = lawaOf(await rpc("wq_state_trend_for_site", { site: site.id }), summary?.preview?.parameters?.parameter || order[0]); } catch { lawaError = true; }
      }
      return line(site, { band, skipped, summary, lawa, lawaError, preset, groupName: group.name });
    }), CONCURRENCY);
    // Every request refused as unavailable (the function not deployed, or down): one message, not a line per site.
    if (lines.every((l) => l.error && !l.summary && !l.band)) return { state: "unavailable", preset, message: lines[0].error };
    return { state: "answered", preset, groupName: group.name, lines, more: picked.more };
  }

  return { QUESTION, MAX_OWN, MAX_REFERENCE, ATTRIBUTES, pickPreset, pickSites, pickArgs, bandRequest, summaryRequest, bandSkipped, lawaOf, line, item, answer, build };
});
