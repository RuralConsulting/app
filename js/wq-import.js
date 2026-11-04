// Import water-quality results (dataset.import): upload a CSV, read the dry-run summary, fix or accept the column mapping in
// one pass, confirm. Reached from the farm space's Create. Every step runs as the signed-in person: the file goes into the
// owner's documents (kept unchanged), the dataset-import function checks it (a remembered layout needs no AI), and Confirm
// calls public.measurement_import_confirm, which checks edit authority again before anything is loaded. Pure, apart from
// request(), confirm() and mount().
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api; else root.FP.wqImport = api;
})(typeof window === "undefined" ? globalThis : window, function () {
  const UNAVAILABLE = "Importing results isn't available yet.";
  const n = (v) => Number(v) || 0;
  const plural = (k, one, many) => k + " " + (k === 1 ? one : many || one + "s");
  const nz = (k) => k.toLocaleString("en-NZ");
  const ROLES = { site: "Site code", site_name: "Site name", date: "Date", time: "Time", datetime: "Date and time", parameter: "What was measured",
    value: "Result", unit: "Unit", qualifier: "< or >", sample_id: "Sample id", lab: "Laboratory", method: "Method", detection_limit: "Detection limit",
    easting: "Easting (NZTM)", northing: "Northing (NZTM)", latitude: "Latitude", longitude: "Longitude", result: "Results of one parameter", ignore: "Not used" };

  // "1,248 results, 14 sites, 2019–2026; 3 new sites; 22 below detection; 6 already held, skipped"
  function sentence(s) {
    if (!s || typeof s !== "object") return "";
    const parts = [nz(n(s.results)) + " " + (n(s.results) === 1 ? "result" : "results") + ", " + plural(n(s.sites), "site")
      + (s.period?.from ? ", " + s.period.from.slice(0, 4) + (s.period.to.slice(0, 4) !== s.period.from.slice(0, 4) ? "–" + s.period.to.slice(0, 4) : "") : "")];
    const fresh = Array.isArray(s.sites_new) ? s.sites_new.length : 0;
    if (fresh) parts.push(plural(fresh, "new site"));
    if (n(s.censored)) parts.push(nz(n(s.censored)) + " below or above detection");
    if (n(s.held)) parts.push(nz(n(s.held)) + " already held, skipped");
    if (n(s.changes)) parts.push(plural(n(s.changes), "correction"));
    if (n(s.conflicts)) parts.push(nz(n(s.conflicts)) + " held with a different value, left as they are");
    if (n(s.skipped_rows)) parts.push(nz(n(s.skipped_rows)) + " not read");
    if (n(s.flagged?.extreme)) parts.push(nz(n(s.flagged.extreme)) + " unusually high or low, flagged");
    if (Array.isArray(s.unknown) && s.unknown.length) parts.push(plural(s.unknown.length, "name or unit", "names or units") + " not in the parameter list, kept as written");
    return parts.join("; ") + ".";
  }
  // What stops Confirm, in words; the date question carries its examples.
  function blockingLines(blocking, s) {
    const ex = (s?.dates?.ambiguous_examples || []).join(", ");
    const words = {
      ambiguous_dates: "Dates like " + (ex || "03/04/2025") + " could be day/month or month/day. Say which.",
      dates_inconsistent: "Some dates are day/month and some month/day. Fix the file and upload it again.",
      no_site_column: "No column is the site. Choose one below.",
      no_date_column: "No column is the date. Choose one below.",
      no_value_column: "No column holds results. Choose them below.",
      mixed_layout: "Use either one row per result (What was measured + Result) or one column per parameter, not both.",
      no_results: "No results could be read from this file.",
    };
    return (Array.isArray(blocking) ? blocking : []).map((b) => words[b] || b);
  }
  async function request(sb, body) {
    let res;
    try { res = await sb.functions.invoke("dataset-import", { body }); } catch { return { kind: "error", message: UNAVAILABLE }; }
    if (!res.error) return res.data && res.data.import_id ? { kind: "checked", result: res.data } : { kind: "error", message: "The check's reply couldn't be read." };
    const status = res.error.context?.status;
    let b = null;
    try { b = await res.error.context.json(); } catch {}
    return status && status !== 404 && b && typeof b.error === "string" ? { kind: "error", message: b.error } : { kind: "error", message: UNAVAILABLE };
  }
  async function confirm(sb, id) {
    const { data, error } = await sb.rpc("measurement_import_confirm", { p_import: id });
    if (error) throw Error(error.message || "That wasn't loaded.");
    return data || {};
  }
  const loadedLine = (r, name) => "Loaded " + plural(n(r.added), "result") + (n(r.changed) ? ", corrected " + n(r.changed) : "") +
    (n(r.held) ? ", " + n(r.held) + " already held" : "") + (name ? " into " + name : "") + ".";

  // ---- the flow -----------------------------------------------------------------------------------------------------------
  function mount(host, { sb, farm, el, documentsBlock }) {
    const box = el("section", { class: "wq-import", "data-wq-import": "" });
    host.append(box);
    let owners = [{ value: "farm:" + farm.id, label: farm.name, farm_id: farm.id, org_id: null }], datasets = [], last = null, mapping = null;
    const status = el("p", { class: "wq-msg", role: "status" });
    const say = (t) => { status.textContent = t || ""; };
    const owner = () => owners.find((o) => o.value === box.querySelector("[name=wq-owner]").value) || owners[0];

    async function loadOwners() {
      const { data } = await sb.from("org_members").select("org_id,role,organisations(name,kind)");
      for (const m of data || []) if (m.role !== "member" && m.organisations?.kind === "catchment_group")
        owners.push({ value: "org:" + m.org_id, label: m.organisations.name, farm_id: null, org_id: m.org_id });
    }
    async function loadDatasets() {
      const o = owner();
      let q = sb.from("measurement_sources").select("key,name,kind").eq("kind", "water-quality");
      q = o.farm_id ? q.eq("farm_id", o.farm_id) : q.eq("org_id", o.org_id);
      const { data } = await q;
      datasets = data || [];
      const sel = box.querySelector("[name=wq-dataset]");
      sel.replaceChildren(...datasets.map((d) => el("option", { value: d.key }, d.name || d.key)), el("option", { value: "" }, "A new dataset…"));
      sel.dispatchEvent(new Event("change"));
    }
    function form() {
      const ownerSel = el("select", { name: "wq-owner", "aria-label": "Whose results" }, ...owners.map((o) => el("option", { value: o.value }, o.label)));
      const dsSel = el("select", { name: "wq-dataset", "aria-label": "Dataset" });
      const name = el("input", { name: "wq-name", type: "text", placeholder: "Name of the new dataset", maxlength: "120", hidden: "" });
      const corr = el("select", { name: "wq-corrects", "aria-label": "Correcting an earlier upload" }, el("option", { value: "" }, "A new upload"));
      const file = el("input", { name: "wq-file", type: "file", accept: ".csv,text/csv" });
      const go = el("button", { type: "submit" }, "Check the file");
      const f = el("form", { class: "wq-form" }, el("h3", {}, "Import water-quality results"),
        el("label", {}, "Whose results ", ownerSel), el("label", {}, "Dataset ", dsSel), name, el("label", {}, "This file is ", corr),
        el("label", {}, "Spreadsheet (CSV) ", file), go, status);
      ownerSel.addEventListener("change", loadDatasets);
      dsSel.addEventListener("change", async () => {
        name.hidden = !!dsSel.value;
        corr.replaceChildren(el("option", { value: "" }, "A new upload"));
        if (!dsSel.value) return;
        const { data } = await sb.from("measurement_imports").select("id,confirmed_at,summary").eq("dataset_key", dsSel.value).eq("status", "loaded").order("confirmed_at", { ascending: false });
        for (const i of data || []) corr.append(el("option", { value: i.id }, "A correction of " + (i.summary?.file_name || "an upload") + " (" + String(i.confirmed_at).slice(0, 10) + ")"));
      });
      f.addEventListener("submit", async (e) => {
        e.preventDefault();
        const picked = file.files && file.files[0];
        if (!picked) return say("Choose a CSV file.");
        if (!dsSel.value && !name.value.trim()) return say("Name the new dataset.");
        go.disabled = true; say("Keeping the file…");
        try {
          const o = owner(), bytes = await picked.arrayBuffer(), sha = await documentsBlock.sha256Hex(bytes);
          const doc = await keep(o, picked, sha);
          say("Checking…");
          await check({ ...(o.farm_id ? { farm_id: o.farm_id } : { org_id: o.org_id }), document_id: doc, ...(dsSel.value ? { dataset_key: dsSel.value } : { dataset_name: name.value.trim() }),
            ...(corr.value ? { corrects_import_id: corr.value } : {}) });
        } catch (err) { say(err?.message || String(err)); }
        go.disabled = false;
      });
      return f;
    }
    // The file, kept unchanged as one of the owner's documents (the same bytes already kept are used again).
    async function keep(o, file, sha) {
      let q = sb.from("documents").select("id").eq("sha256", sha);
      q = o.farm_id ? q.eq("farm_id", o.farm_id) : q.eq("org_id", o.org_id);
      const found = await q.maybeSingle();
      if (found.data) return found.data.id;
      const path = documentsBlock.storagePath(o.farm_id || "org/" + o.org_id, sha, file.name);
      const up = await sb.storage.from("documents").upload(path, file, { contentType: file.type || "text/csv", upsert: false });
      if (up.error && !/exist|duplicate|409/i.test(String(up.error.message || "") + (up.error.statusCode || ""))) throw up.error;
      const { data, error } = await sb.from("documents").insert({ farm_id: o.farm_id, org_id: o.org_id, title: file.name, doc_type: "measurements",
        original_name: file.name, mime_type: file.type || "text/csv", sha256: sha, size_bytes: file.size, storage_path: path, tier: "primary",
        tiered_at: new Date().toISOString() }).select("id").single();
      if (error) throw error;
      return data.id;
    }
    async function check(body) {
      const r = await request(sb, body);
      if (r.kind !== "checked") return say(r.message);
      last = r.result; mapping = JSON.parse(JSON.stringify(last.mapping));
      say(""); summary();
    }
    function summary() {
      box.querySelector(".wq-summary")?.remove();
      const s = last.summary || {}, block = blockingLines(last.blocking, s);
      const rows = Object.keys(mapping.columns).map((k) => {
        const c = mapping.columns[k];
        const sel = el("select", { "data-wq-col": k, "aria-label": "Column " + c.header }, ...Object.entries(ROLES).map(([v, l]) => el("option", { value: v, ...(v === c.role ? { selected: "" } : {}) }, l)));
        sel.addEventListener("change", () => { mapping.columns[k] = { ...c, role: sel.value, from: "person" }; });
        const how = c.from === "ai" ? "suggested by AI" : c.from === "saved" ? "as last time" : c.from === "unmapped" ? "not recognised" : c.from === "person" ? "your choice" : "";
        return el("tr", {}, el("th", { scope: "row" }, c.header), el("td", {}, sel), el("td", { class: "wq-how" }, how + (c.role === "result" ? (c.parameter ? " · " + c.parameter : " · not in the list") + (c.unit ? " (" + c.unit + ")" : "") : "")));
      });
      const changes = (s.change_list || []).map((c) => el("li", {}, c.site + " · " + c.parameter + " · " + String(c.sampled_at).slice(0, 10) + ": " + c.was + " → " + c.now));
      const order = (v, label) => el("button", { type: "button", "data-wq-order": v }, label);
      const confirmBtn = el("button", { type: "button", "data-wq-confirm": "", ...(block.length ? { disabled: "" } : {}) }, "Confirm and load");
      const again = el("button", { type: "button", class: "link", "data-wq-again": "" }, "Check again with these columns");
      const out = el("div", { class: "wq-summary" },
        el("p", { class: "wq-sentence" }, sentence(s)),
        ...block.map((t) => el("p", { class: "wq-block" }, t)),
        ...(last.blocking?.includes("ambiguous_dates") ? [el("p", {}, order("dmy", "Day first (NZ)"), " ", order("mdy", "Month first"))] : []),
        ...(changes.length ? [el("h4", {}, "Corrections"), el("ul", {}, ...changes)] : []),
        el("table", { class: "wq-map" }, el("tbody", {}, ...rows)), again, " ", confirmBtn);
      out.addEventListener("click", async (e) => {
        const t = e.target.closest("button");
        if (!t) return;
        if (t.dataset.wqOrder) { say("Checking…"); await check({ import_id: last.import_id, date_order: t.dataset.wqOrder, mapping }); }
        else if (t.hasAttribute("data-wq-again")) { say("Checking…"); await check({ import_id: last.import_id, mapping, ...(last.summary?.dates?.decided_by === "person" ? { date_order: last.summary.dates.order } : {}) }); }
        else if (t.hasAttribute("data-wq-confirm")) {
          t.disabled = true; say("Loading…");
          try { const r = await confirm(sb, last.import_id); out.replaceChildren(el("p", { class: "wq-done" }, loadedLine(r, last.new_dataset_name))); say(""); }
          catch (err) { t.disabled = false; say(err.message); }
        }
      });
      box.append(out);
    }
    box.append(form());
    loadOwners().then(() => {
      const sel = box.querySelector("[name=wq-owner]");
      sel.replaceChildren(...owners.map((o) => el("option", { value: o.value }, o.label)));
      return loadDatasets();
    }).catch((e) => say(e?.message || String(e)));
    return { destroy: () => box.remove() };
  }
  return { sentence, blockingLines, request, confirm, loadedLine, mount, ROLES };
});
