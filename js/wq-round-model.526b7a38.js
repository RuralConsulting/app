// SR1: entering a water sampling round, the pure parts (no DOM, no reads): the measures and methods a round can be, a value as typed
// (a number or a censored one such as "<0.05", as the loaders keep it: mirrored from app.sampling_round_value in migration
// 20261113073000), the sheet's checks (a number; a plausible range and the site's own history warn, never block; a value and "not
// sampled" never both; a laboratory check needs the laboratory's name), a column pasted from a spreadsheet, the review's figures, the
// text for the monthly report, the draft kept in the browser and what is sent to public.sampling_round_save.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else { root.FP = root.FP || {}; root.FP.wqRoundModel = api; }
})(typeof window === "undefined" ? globalThis : window, function () {
  const list = (v) => (Array.isArray(v) ? v : []);

  // The measures a group samples, with the canonical unit (public.parameters), a plausible range (a value outside it is asked about, never
  // refused) and the least difference worth calling unusual against a site's own median.
  const MEASURES = [
    { key: "nitrate-n", name: "Nitrate-N", long: "Nitrate nitrogen", unit: "mg/L", range: [0, 30], floor: 0.5 },
    { key: "nitrate-nitrite-n", name: "Nitrate-nitrite-N", long: "Nitrate-nitrite nitrogen (NNN)", unit: "mg/L", range: [0, 30], floor: 0.5 },
    { key: "e-coli", name: "E. coli", long: "E. coli", unit: "/100 mL", range: [0, 50000], floor: 100 },
    { key: "turbidity", name: "Turbidity", long: "Turbidity", unit: "NTU", range: [0, 1000], floor: 5 },
    { key: "clarity", name: "Clarity", long: "Visual clarity (black disc)", unit: "m", range: [0, 20], floor: 0.5 },
    { key: "conductivity", name: "Conductivity", long: "Conductivity (at 25 °C)", unit: "µS/cm", range: [0, 5000], floor: 50 },
    { key: "temperature", name: "Temperature", long: "Water temperature", unit: "°C", range: [0, 30], floor: 3 },
    { key: "ph", name: "pH", long: "pH", unit: "pH units", range: [4, 10], floor: 0.5 },
    { key: "dissolved-oxygen", name: "Dissolved oxygen", long: "Dissolved oxygen", unit: "mg/L", range: [0, 20], floor: 2 },
    { key: "drp", name: "DRP", long: "Dissolved reactive phosphorus", unit: "mg/L", range: [0, 2], floor: 0.02 },
    { key: "ammoniacal-n", name: "Ammoniacal-N", long: "Ammoniacal nitrogen", unit: "mg/L", range: [0, 10], floor: 0.2 },
  ];
  const DEFAULT_MEASURE = "nitrate-n";
  const measure = (key) => MEASURES.find((m) => m.key === key) || null;
  const METHODS = [
    { key: "field-sensor", name: "Field sensor" },
    { key: "test-strip", name: "Test strip" },
    { key: "laboratory", name: "Laboratory" },
  ];
  const methodName = (key) => METHODS.find((m) => m.key === key)?.name || key;
  const MAX_SITES = 1000;

  // ---- a value as typed -----------------------------------------------------------------------------------------------------------------
  // "" -> { empty }; "2.5" -> { value: 2.5, qualifier: null, text: "2.5" }; "< 0.05" -> { value: 0.05, qualifier: "<", text: "<0.05" };
  // anything else -> { error }. The same rule as the database's (spaces ignored; <, >, ≤, ≥; no sign, no exponent).
  const MAX_TEXT = 20;   // as app.sampling_round_value: no value's text can be made long (leading zeros pass the pattern)
  const VALUE = /^[<>≤≥]?([0-9]+(\.[0-9]*)?|\.[0-9]+)$/;
  function parseValue(t) {
    const s = String(t ?? "").replace(/\s/g, "");
    if (!s) return { empty: true };
    if (s.length > MAX_TEXT) return { error: "Too long to be a result (at most " + MAX_TEXT + " characters)" };
    if (!VALUE.test(s)) return { error: s.startsWith("-") ? "A value cannot be below zero" : "Not a number (a value below the limit is written like <0.05)" };
    const q = /^[<>≤≥]/.test(s) ? s[0] : null, value = Number(q ? s.slice(1) : s);
    if (value > 1e6) return { error: "Too large to be a result" };
    return { value, qualifier: q, text: s };
  }

  // ---- the sheet ----------------------------------------------------------------------------------------------------------------------------
  // sites: [{ id, name, external_id }]; history: { [site id]: { latestText, latestAt, median, n } }.
  // A row: { site_id, value, check, notSampled, note } (value and check as typed).
  const blankRow = (siteId) => ({ site_id: siteId, value: "", check: "", notSampled: false, note: "" });
  function rowsFor(sites, saved = []) {
    const by = new Map(list(saved).map((e) => [Number(e.site_id), e]));
    return list(sites).map((s) => {
      const e = by.get(Number(s.id));
      return e ? { site_id: s.id, value: e.value ?? "", check: e.check ?? "", notSampled: !!(e.not_sampled ?? e.notSampled), note: e.note ?? "" } : blankRow(s.id);
    });
  }
  // Each row's messages: errors (block the save) and warnings (asked about, never block), and the sheet's own errors.
  function check(rows, { measureKey = DEFAULT_MEASURE, method = "field-sensor", lab = "", checkLab = "", history = {}, sampledOn = null, today = null } = {}) {
    const m = measure(measureKey), out = new Map(), sheet = [];
    let values = 0, checks = 0;
    for (const r of list(rows)) {
      const errors = [], warnings = [], v = parseValue(r.value), c = parseValue(r.check);
      if (v.error) errors.push(v.error);
      if (c.error) errors.push("Laboratory check: " + c.error.charAt(0).toLowerCase() + c.error.slice(1));
      if (r.notSampled && (!v.empty || !c.empty)) errors.push("Marked not sampled: clear the value or untick Not sampled");
      if (!c.empty && !c.error && method === "laboratory") errors.push("A laboratory round has no separate check");
      if (String(r.note || "").trim().length > 500) errors.push("A note is at most 500 characters");
      if (!v.empty && !v.error) {
        values++;
        if (m && (v.value < m.range[0] || v.value > m.range[1])) warnings.push("Outside the usual range for " + m.name + " (" + m.range[0] + " to " + m.range[1] + " " + m.unit + "): check it");
        const u = unusual(v.value, history[r.site_id], m);
        if (u) warnings.push(u);
      }
      if (!c.empty && !c.error) {
        checks++;
        if (!v.empty && !v.error && v.value > 0 && c.value > 0 && Math.max(v.value, c.value) / Math.min(v.value, c.value) >= 2 && Math.abs(v.value - c.value) >= (m?.floor || 0))
          warnings.push("The reading and the laboratory check differ by more than half");
      }
      out.set(r.site_id, { errors, warnings });
    }
    if (checks && !String(checkLab || "").trim() && method !== "laboratory") sheet.push("Name the laboratory the checks went to");
    if (method === "laboratory" && !String(lab || "").trim()) sheet.push("Name the laboratory");
    if (!values && !checks) sheet.push("Enter at least one value");
    if (sampledOn && today && sampledOn > today) sheet.push("The round's date is in the future");
    if (!sampledOn) sheet.push("Choose the round's date");
    const errors = [...out.values()].reduce((n, x) => n + x.errors.length, 0) + sheet.length;
    return { rows: out, sheet, errors, warnings: [...out.values()].reduce((n, x) => n + x.warnings.length, 0) };
  }
  // Against the site's own record: at least three results and a median above nothing; twice or half the median, by at least the floor.
  function unusual(value, h, m) {
    if (!h || !(h.n >= 3) || !(Number(h.median) > 0)) return null;
    const med = Number(h.median), floor = m?.floor || 0;
    if (value >= med * 2 && value - med >= floor) return "High for this site (its median is " + num(med) + ")";
    if (value <= med / 2 && med - value >= floor) return "Low for this site (its median is " + num(med) + ")";
    return null;
  }
  const num = (n) => (n == null ? "" : String(Number(Number(n).toPrecision(3))));

  // ---- paste ------------------------------------------------------------------------------------------------------------------------------
  // A block copied from a spreadsheet: rows on lines, cells on tabs. Returns the cells as rows of strings, trailing blank line dropped.
  // A single value (no tab, no line break) is null: the browser's own paste puts it in the box.
  function pasted(text) {
    const s = String(text ?? "").replace(/\r\n?/g, "\n");
    if (!/[\n\t]/.test(s.replace(/\n$/, ""))) return null;
    const lines = s.replace(/\n$/, "").split("\n");
    return lines.map((l) => l.split("\t").map((c) => c.trim()));
  }
  // Fill down from the row and column the paste began in: the first cell into that column, a second into the next (value, then check).
  // Rows marked not sampled keep their tick unless a value lands on them (then the tick is taken off). Returns how many rows changed.
  const COLUMNS = ["value", "check"];
  function fillDown(rows, startIndex, column, cells, { withCheck = true } = {}) {
    const cols = withCheck ? COLUMNS : ["value"];
    let at = cols.indexOf(column), changed = 0;
    if (at < 0) return 0;
    list(cells).forEach((cellRow, i) => {
      const r = rows[startIndex + i];
      if (!r) return;
      let touched = false;
      cellRow.forEach((cell, j) => {
        const col = cols[at + j];
        if (!col) return;
        r[col] = cell; touched = true;
        if (cell) r.notSampled = false;
      });
      if (touched) changed++;
    });
    return changed;
  }

  // ---- the review -----------------------------------------------------------------------------------------------------------------------
  // The round's figures: sites with a value, not sampled, left blank, laboratory checks, the highest, the median and the range (a censored
  // value counts at its limit; a median or range a censored value could move keeps its sign), and what is unusual.
  function summary(rows, { sites = [], measureKey = DEFAULT_MEASURE, method = "field-sensor", lab = "", checkLab = "", history = {} } = {}) {
    const m = measure(measureKey), names = new Map(list(sites).map((s) => [s.id, s.name || s.external_id || "Site " + s.id]));
    const vals = [], checks = [];
    let notSampled = 0, blank = 0;
    for (const r of list(rows)) {
      const v = parseValue(r.value), c = parseValue(r.check);
      if (!v.empty && !v.error) vals.push({ site: r.site_id, ...v });
      if (!c.empty && !c.error && method !== "laboratory") checks.push({ site: r.site_id, ...c });
      if (r.notSampled) notSampled++;
      else if (v.empty && c.empty) blank++;
    }
    const sorted = [...vals].sort((a, b) => a.value - b.value);
    const med = median(sorted.map((x) => x.value));
    const low = sorted[0] || null, high = sorted[sorted.length - 1] || null;
    const medCensored = med != null && sorted.some((x) => (x.qualifier === "<" || x.qualifier === "≤") && x.value >= med);
    const unusualRows = vals.map((x) => ({ site: x.site, name: names.get(x.site), text: x.text, why: unusual(x.value, history[x.site], m) || outside(x.value, m) })).filter((x) => x.why);
    return {
      sites: list(rows).length, entered: vals.length, notSampled, blank, labChecks: checks.length, tests: vals.length + checks.length,
      highest: high ? { name: names.get(high.site), text: high.text } : null,
      median: med == null ? null : (medCensored ? "≤" : "") + num(med), low: low?.text ?? null, high: high?.text ?? null,
      unit: m?.unit || "", measure: m, method, lab: String(lab || "").trim(), checkLab: String(checkLab || "").trim(), unusual: unusualRows,
    };
  }
  const outside = (v, m) => (m && (v < m.range[0] || v > m.range[1]) ? "Outside the usual range for " + m.name : null);
  function median(xs) {
    const a = [...xs].filter((x) => Number.isFinite(x)).sort((p, q) => p - q);
    if (!a.length) return null;
    const mid = Math.floor(a.length / 2);
    return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
  }

  // ---- the monthly report -------------------------------------------------------------------------------------------------------------
  // The numbers a facilitator retypes into the monthly report, as plain text with the date.
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function dateWords(iso, long = true) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
    if (!m) return "";
    return Number(m[3]) + " " + (long ? MONTHS : SHORT)[Number(m[2]) - 1] + " " + m[1];
  }
  function reportText(s, { group = "", dataset = "", sampledOn = "" } = {}) {
    const unit = s.unit ? " " + s.unit : "", how = methodName(s.method).toLowerCase() + (s.method === "laboratory" && s.lab ? " (" + s.lab + ")" : "");
    const lines = [
      "Water sampling round, " + dateWords(sampledOn) + (group ? ", " + group : ""),
      (s.measure?.long || s.measure?.name || "") + " by " + how + (dataset ? " · " + dataset : ""),
      "Tests done: " + s.tests,
      "Sites sampled: " + s.entered + " of " + s.sites + (s.notSampled ? " (" + s.notSampled + " not sampled)" : ""),
      "Laboratory checks sent: " + s.labChecks + (s.labChecks && s.checkLab ? " (" + s.checkLab + ")" : ""),
      "Median: " + (s.median == null ? "none" : s.median + unit),
      "Range: " + (s.low == null ? "none" : s.low === s.high ? s.low + unit : s.low + " to " + s.high + unit),
    ];
    return lines.join("\n");
  }

  // ---- what is sent, and the draft --------------------------------------------------------------------------------------------------------
  // The sheet as public.sampling_round_save takes it: only rows with something in them, values tidied (spaces out), no checks on a
  // laboratory round.
  function payload(rows, { method = "field-sensor" } = {}) {
    return list(rows).filter((r) => String(r.value || "").trim() || String(r.check || "").trim() || r.notSampled || String(r.note || "").trim())
      .map((r) => ({ site_id: Number(r.site_id), value: String(r.value || "").replace(/\s/g, "") || null,
        check: method === "laboratory" ? null : String(r.check || "").replace(/\s/g, "") || null, not_sampled: !!r.notSampled, note: String(r.note || "").trim() || null }));
  }
  // The unsaved sheet, kept per person and group (and round when correcting one), so on a shared computer another coordinator of the
  // same group never gets the last person's sheet or notes. LEGACY: the first version's keys (per group only), cleared on load.
  const draftKey = (userId, groupId, roundId = null) => "fp.round.v2." + (userId || "anon") + "." + groupId + (roundId ? "." + roundId : "");
  const LEGACY_DRAFT = /^fp\.round\.draft\./;
  const isLegacyDraft = (k) => LEGACY_DRAFT.test(String(k || ""));
  function draftOf(text) {
    try {
      const d = JSON.parse(text);
      if (!d || typeof d !== "object" || !d.id || !Array.isArray(d.rows)) return null;
      return d;
    } catch { return null; }
  }
  // A round as the database keeps it (public.sampling_rounds), back into the screen's state.
  function fromSaved(r, sites) {
    return { id: r.id, dataset: r.dataset_key, sampledOn: r.sampled_on, measureKey: r.parameter, method: r.method, lab: r.lab || "", checkLab: r.check_lab || "",
      note: r.note || "", revision: r.revision, rows: rowsFor(sites, r.entries), saved: true };
  }
  // Whether a new round would repeat one already saved (same dataset, day, measure and method): its id, else null.
  const sameRound = (rounds, st) => list(rounds).find((r) => r.id !== st.id && r.dataset_key === st.dataset && r.sampled_on === st.sampledOn && r.parameter === st.measureKey && r.method === st.method)?.id || null;
  // The database's refusal, in the screen's words.
  function errorWords(e) {
    const msg = String(e?.message || e || "");
    if (/changed since you opened it/i.test(msg)) return "Someone saved this round after you opened it. Open it again to see their changes; your typing is kept here.";
    if (/already saved/i.test(msg)) return "A round of this measure on that day is already saved. Open it from the list to correct it.";
    if (/group you coordinate/i.test(msg)) return "Only the group's coordinators can enter a round.";
    if (/fetch|network|Failed to/i.test(msg)) return "Couldn't reach the server. Your round is kept on this computer; try Save again.";
    return msg.replace(/^.*?: /, "") || "Couldn't save the round just now.";
  }
  const newId = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, () => Math.floor(Math.random() * 16).toString(16)));
  const href = (groupId, roundId = null) => "#/group/" + groupId + "/water/round" + (roundId ? "?item=" + roundId : "");
  const canEnter = (role) => ["facilitator", "advisor", "admin"].includes(role);

  return { MEASURES, DEFAULT_MEASURE, measure, METHODS, methodName, MAX_SITES, parseValue, blankRow, rowsFor, check, unusual, pasted, fillDown, summary, median,
    dateWords, reportText, payload, draftKey, isLegacyDraft, MAX_TEXT, draftOf, fromSaved, sameRound, errorWords, newId, href, canEnter, num };
});
