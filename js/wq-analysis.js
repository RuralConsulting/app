// Water-quality analysis (X1): the card Ask shows for each analysis.run preview. The figures were calculated by the platform's
// tested library (supabase/functions/_shared/wq), never by the model; the card shows them as a small table with the method,
// its citation, the caveats and whose data it is. Confirm (an editor of the farm) sends the preview back to the analysis
// function, which recalculates it and records it as the person (in the database) only if it is still the same;
// "Adjust method" recalculates with the person's settings first (the window's last year, its length, a suspended sediment class
// with its REC group). After confirming, "Save as note" adds the text to the farm's own advisor note on the site layer
// (layer_notes, as the person), offered only when every input is shared reference data. Pure, apart from request() and saveNote().
// The chart block (B8) plugs in where the card marks it: until then results are text and a table.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api; else root.FP.wqAnalysis = api;
})(typeof window === "undefined" ? globalThis : window, function () {
  const UNAVAILABLE = "Water-quality analysis isn't available yet.";
  const TOOLS = ["summary", "band", "trend", "compare", "exceedance"];
  const HEX64 = /^[0-9a-f]{64}$/;
  const list = (v) => (Array.isArray(v) ? v : []);
  const str = (v) => typeof v === "string" && v.trim() !== "";
  const obj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const range = (i, unit) => {
    if (!obj(i)) return "–";
    const u = unit ? " " + unit : "";
    if (i.exact || i.lo === i.hi) return String(i.lo) + u;
    if (i.hi === null) return "≥ " + i.lo + u;
    if (i.lo === 0) return "≤ " + i.hi + u;
    return i.lo + " to " + i.hi + u;
  };

  // A preview as the function sent it, kept to the shape the card knows; null when it isn't one.
  function preview(p) {
    if (!obj(p) || !TOOLS.includes(p.tool) || !HEX64.test(String(p.preview_sha256)) || !obj(p.method) || !obj(p.parameters) || !obj(p.site)) return null;
    return { tool: p.tool, tool_version: String(p.tool_version || ""), method: p.method, parameters: p.parameters, site: p.site,
      ai_proposed_inputs: obj(p.ai_proposed_inputs) ? p.ai_proposed_inputs : null, advisor_overrides: obj(p.advisor_overrides) ? p.advisor_overrides : {},
      measurement_sources: list(p.measurement_sources).filter(str), attribution: list(p.attribution).filter(obj),
      result: obj(p.result) ? p.result : null, unavailable: obj(p.unavailable) && str(p.unavailable.detail) ? p.unavailable : null,
      caveats: list(p.caveats).filter(str), statement: str(p.statement) ? p.statement : "", preview_sha256: p.preview_sha256, note_allowed: p.note_allowed === true,
      state: null, message: "", overrides: {} };
  }

  // What a preview or confirm sends: the settings as first proposed (the model's, from Ask), the person's changes as
  // overrides, and for confirm the preview they saw. The function recalculates from these; it takes no figures.
  function body(p, mode, owner, overrides) {
    const proposed = p.ai_proposed_inputs || Object.fromEntries(Object.entries(p.parameters).filter(([k]) => !["from", "to", "site"].includes(k)));
    return { mode, owner, params: proposed, ...(p.ai_proposed_inputs ? { ai_proposed_inputs: p.ai_proposed_inputs } : {}),
      ...(overrides && Object.keys(overrides).length ? { overrides } : {}), ...(mode === "confirm" ? { preview_sha256: p.preview_sha256 } : {}) };
  }
  async function request(sb, payload) {
    let res;
    try { res = await sb.functions.invoke("analysis", { body: payload }); } catch { return { kind: "error", message: UNAVAILABLE }; }
    if (!res.error) {
      const p = preview(res.data?.preview);
      if (!p) return { kind: "error", message: "The analysis couldn't be read." };
      return res.data?.saved ? { kind: "saved", id: String(res.data.saved.id), preview: p } : { kind: "preview", preview: p };
    }
    const status = res.error.context?.status;
    let data = null;
    try { data = await res.error.context.json(); } catch {}
    const p = preview(data?.preview);
    if (status === 409 && data?.changed && p) return { kind: "changed", preview: p, message: str(data.error) ? data.error : "The result has changed. Check it and confirm again." };
    return status && status !== 404 && data && str(data.error) ? { kind: "error", message: data.error } : { kind: "error", message: UNAVAILABLE };
  }

  // The note a person may save: the statement and the caveats, which they can edit first.
  const noteText = (p) => [p.statement, ...p.caveats].filter(str).join(" ").slice(0, 1500);
  // Adds the text to the farm's own note on the site's layer (one note per layer, scope and owner), as the person.
  async function saveNote(sb, farm, p, text) {
    const key = p.site?.source_key, add = String(text || "").trim();
    if (!p.note_allowed || !str(key) || !add) throw Error("This analysis can't be saved as a note.");
    const { data: found, error: e1 } = await sb.from("layer_notes").select("id,notes").eq("source_key", key).eq("scope", "farm").eq("farm_id", farm).maybeSingle();
    if (e1) throw Error(e1.message || "The note wasn't saved.");
    const stamp = new Intl.DateTimeFormat("en-NZ", { day: "numeric", month: "short", year: "numeric", timeZone: "Pacific/Auckland" }).format(new Date());
    const entry = stamp + ": " + add;
    if (found) {
      const notes = ((found.notes ? found.notes + "\n\n" : "") + entry).slice(-4000);
      const { error } = await sb.from("layer_notes").update({ notes }).eq("id", found.id);
      if (error) throw Error(error.message || "The note wasn't saved.");
    } else {
      const { error } = await sb.from("layer_notes").insert({ source_key: key, scope: "farm", farm_id: farm, notes: entry });
      if (error) throw Error(/row-level security|permission/i.test(error.message || "") ? "Only an editor of the farm can add a note." : error.message || "The note wasn't saved.");
    }
  }

  // The result as rows of a small table: [label, value].
  function rows(p) {
    const r = p.result || {}, unit = r.unit || "";
    if (p.tool === "band" && r.band) {
      return [["Band", r.band], ...list(r.statistics).map((s) => [s.label, s.display + (s.band ? " (" + s.band + ")" : "")]),
        ["Monthly values", String(r.monthly_values)], ...(r.sediment_class ? [["Suspended sediment class", String(r.sediment_class)]] : [])];
    }
    if (p.tool === "summary" && num(r.samples) !== null) {
      const pc = r.percentiles || {};
      return [["Samples", String(r.samples)], ["Below / above detection", r.censored_below + " / " + r.censored_above], ["Median", range(r.median, unit)],
        ...(r.percentiles ? [["5th / 95th percentile", range(pc.p5, unit) + " / " + range(pc.p95, unit)]] : []), ["Range", range(r.min, unit) + " to " + range(r.max, unit)],
        ["First / last sample", (r.first || "–") + " / " + (r.last || "–")]];
    }
    if (p.tool === "trend" && r.category) {
      const conf = Math.round(100 * Math.max(r.p_decreasing || 0, r.p_increasing || 0));
      const slope = r.sen_slope && num(r.sen_slope.per_year) !== null ? r.sen_slope.per_year + " " + r.sen_slope.unit : "not given (censored results decide it)";
      return [["Trend", r.assessment === "indeterminate" ? "Indeterminate" : r.category + " " + r.assessment], ["Confidence", conf + "% of " + (r.p_decreasing >= r.p_increasing ? "a decrease" : "an increase")],
        ["Sen slope", slope], ["Values", r.values + " " + r.seasons + (r.seasonal ? ", seasonal test" : "")]];
    }
    if (p.tool === "compare") return list(r.sites).map((s) => [s.site + " — " + s.relation, s.summary ? "median " + range(s.summary.median, unit) + ", " + s.summary.samples + " samples" : "not available: " + (s.unavailable?.detail || "")]);
    if (p.tool === "exceedance" && r.framework) return [["Framework", r.framework + ", " + r.clause], ["Limit", r.limit + " " + r.unit], ["Samples over", r.over.lo === r.over.hi ? r.over.lo + " of " + r.samples : r.over.lo + " to " + r.over.hi + " of " + r.samples]];
    return [];
  }

  const TITLES = { summary: "Summary", band: "NPS-FM attribute band", trend: "Trend (indicative)", compare: "Comparison with council sites", exceedance: "Exceedance of a framework limit" };
  // The card. o: {n (its index), canConfirm (an editor of the farm)}.
  function html(p, o = {}) {
    const n = esc(o.n ?? 0), site = p.site.name ? esc(p.site.name) : "Site " + esc(p.site.monitoring_site_id);
    const period = str(p.parameters.from) ? esc(p.parameters.from) + " to " + esc(p.parameters.to) : "";
    const table = rows(p);
    const body = p.unavailable
      ? '<p class="wq-unavailable">Not available: ' + esc(p.unavailable.detail) + "</p>"
      : '<table class="wq-table"><tbody>' + table.map(([k, v]) => "<tr><th scope=\"row\">" + esc(k) + "</th><td>" + esc(v) + "</td></tr>").join("") + "</tbody></table>" +
        "<!-- the chart block plugs in here (the series and band ranges); until then the card is text and a table. -->";
    const method = '<p class="wq-method">Method: ' + esc(p.method.id) + (p.method.table ? ", " + esc(p.method.table) : "") + (p.method.instrument ? " — " + esc(String(p.method.instrument).split(", http")[0]) : "") +
      (p.method.min_record ? ". Minimum record: " + esc(p.method.min_record) : "") + ".</p>";
    const caveats = p.caveats.length ? '<ul class="wq-caveats">' + p.caveats.map((c) => "<li>" + esc(c) + "</li>").join("") + "</ul>" : "";
    const attr = p.attribution.length ? '<p class="wq-attr">' + p.attribution.map((a) => esc(a.statement || a.name)).join(" ") + "</p>" : "";
    let actions = "";
    if (p.state === "saved") {
      actions = '<p class="wq-msg" role="status">Recorded as the farm\'s analysis, confirmed by you.</p>' +
        (p.note_allowed && o.canConfirm ? (p.noteSaved ? '<p class="wq-msg" role="status">Saved as a note on the site layer.</p>'
          : '<label class="wq-note-label">Note for the site layer<textarea data-wq-note-text="' + n + '" rows="3">' + esc(noteText(p)) + "</textarea></label>" +
            '<button type="button" data-wq-note="' + n + '">Save as note</button>') : "") + (p.note_allowed ? "" : '<p class="wq-msg">Not offered as a note: it uses data that is not shared reference data.</p>');
    } else if (!p.unavailable && o.canConfirm) {
      actions = '<button type="button" data-wq-confirm="' + n + '">Confirm and record</button>' +
        '<details class="wq-adjust"><summary>Adjust method</summary>' +
        '<label>Period ends June <input type="number" min="1990" max="2100" data-wq-set="end_year" value="' + esc(p.parameters.end_year ?? "") + '"></label>' +
        (p.tool === "trend" ? '<label>Years <select data-wq-set="years">' + [5, 10, 15, 20].map((y) => "<option" + (p.parameters.years === y ? " selected" : "") + ">" + y + "</option>").join("") + "</select></label>" : "") +
        (p.tool === "band" && p.parameters.attribute === "suspended-fine-sediment" ? '<label>Suspended sediment class <select data-wq-set="sediment_class"><option value="">–</option><option>1</option><option>2</option><option>3</option><option>4</option></select></label>' +
          '<label>REC group <input type="text" maxlength="20" data-wq-set="rec_group" placeholder="e.g. CD_Low_HS"></label>' : "") +
        '<button type="button" class="link" data-wq-recalc="' + n + '">Recalculate</button></details>';
    } else if (!p.unavailable) {
      actions = '<span class="wq-who">An editor of the farm confirms analyses.</span>';
    } else if (o.canConfirm && p.tool === "band" && p.unavailable.reason === "missing_class") {
      actions = '<details class="wq-adjust" open><summary>Give the class</summary><label>Suspended sediment class <select data-wq-set="sediment_class"><option value="">–</option><option>1</option><option>2</option><option>3</option><option>4</option></select></label>' +
        '<label>REC group <input type="text" maxlength="20" data-wq-set="rec_group" placeholder="e.g. CD_Low_HS"></label><button type="button" class="link" data-wq-recalc="' + n + '">Recalculate</button></details>';
    }
    return '<div class="wq-card" data-wq-card="' + n + '"><h3 class="wq-title">' + esc(TITLES[p.tool]) + ": " + site + "</h3>" +
      (period ? '<p class="wq-period">' + esc(p.parameters.parameter || p.parameters.attribute || "") + ", " + period + "</p>" : "") + body + method + caveats + attr +
      '<div class="wq-actions">' + actions + '</div><p class="wq-msg" role="status" aria-live="polite">' + esc(p.message || "") + "</p></div>";
  }
  // The settings a person changed in the card's Adjust method, as overrides (with any made before): a setting left as the
  // preview has it is not an override.
  function overridesFrom(card, p) {
    const out = { ...(p.overrides || {}) };
    for (const i of card.querySelectorAll("[data-wq-set]")) {
      const k = i.dataset.wqSet, raw = String(i.value || "").trim();
      if (!raw) continue;
      const v = ["end_year", "years", "sediment_class"].includes(k) ? Number(raw) : raw;
      if (v !== p.parameters[k]) out[k] = v;
    }
    return out;
  }
  return { UNAVAILABLE, preview, body, request, html, rows, noteText, saveNote, overridesFrom };
});
