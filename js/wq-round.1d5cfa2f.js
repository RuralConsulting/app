// SR1: a group's coordinator enters a water sampling round (`#/group/<id>/water/round`), and reopens one to correct it
// (`.../water/round?item=<round>`). A desk job first, on a phone too. Top to bottom: the round's heading in the light form rows
// (form-rows.js: the dataset when the group has more than one, the date, the measure with its unit, the method, the laboratory), then ONE
// table: a row per registered site of the dataset (its name, the last result and date for context, a box for this round's value, a
// laboratory check box, a "not sampled" tick, a note). Tab and Enter move down a column; a column pasted from a spreadsheet fills down.
// Review shows the round's figures and anything unusual; Save writes the round in one transaction (public.sampling_round_save, migration
// 20261113073000). A saved round opens as its summary, with the text for the monthly report and "Correct values". What is typed is kept
// in this browser until it is saved, so a lost connection loses nothing.
// Reads, as the signed-in person under the existing policies: measurement_sources (the group's own water-quality datasets),
// sampling_rounds (the group's coordinators only), monitoring_sites (the dataset's sites), wq_site_figures (each site's last result and
// median, 250 a call). The words and the rules are wq-round-model.js's.
(function (root) {
  const FP = root.FP;
  const M = () => FP.wqRoundModel;
  const el = (...a) => FP.el(...a);
  const list = (v) => (Array.isArray(v) ? v : []);
  const fill = (node, ...kids) => node.replaceChildren(...kids.flat().filter((k) => k != null && k !== false));
  const fmt = (n) => Number(n || 0).toLocaleString("en-NZ");
  const store = {
    get(k) { try { return root.localStorage?.getItem(k) ?? null; } catch { return null; } },
    set(k, v) { try { root.localStorage?.setItem(k, v); return true; } catch { return false; } },
    drop(k) { try { root.localStorage?.removeItem(k); } catch { /* nothing kept */ } },
  };
  const missingTable = (e) => ["42P01", "PGRST205", "PGRST202", "42883"].includes(e?.code) || /does not provide|does not exist|schema cache/i.test(String(e?.message || ""));
  const familyOf = (key) => (key === "nitrate-n" || key === "nitrate-nitrite-n" ? "nitrate" : key);
  const todayIso = (today) => (today ? String(today).slice(0, 10) : new Date(Date.now() + 13 * 3600e3).toISOString().slice(0, 10));

  // ---- reads ----------------------------------------------------------------------------------------------------------------------------
  async function datasetsOf(sb, groupId) {
    const { data, error } = await sb.from("measurement_sources").select("key, name, org_id, kind").eq("org_id", groupId).eq("kind", "water-quality").order("name").limit(50);
    if (error) throw error;
    return list(data);
  }
  async function roundsOf(sb, groupId, limit = 6) {
    const { data, error } = await sb.from("sampling_rounds").select("id, dataset_key, sampled_on, parameter, method, lab, check_lab, counts, revision, updated_at")
      .eq("org_id", groupId).order("sampled_on", { ascending: false }).limit(limit);
    if (error) throw error;
    return list(data);
  }
  async function sitesOf(sb, dataset) {
    const { data, error } = await sb.from("monitoring_sites").select("id, external_id, name, site_type").eq("source_key", dataset).order("name").limit(M().MAX_SITES + 1);
    if (error) throw error;
    return list(data).sort((a, b) => String(a.name || a.external_id).localeCompare(String(b.name || b.external_id), "en-NZ", { numeric: true }));
  }
  // each site's last result of the measure (else of its family) and its median, n (field readings included: a group's own record)
  async function historyOf(sb, sites, measureKey) {
    const out = {}, ids = sites.map((s) => s.id);
    for (let i = 0; i < ids.length; i += 250) {
      const { data, error } = await sb.rpc("wq_site_figures", { p_sites: ids.slice(i, i + 250), p_family: familyOf(measureKey), p_from: null, p_include_field: true });
      if (error) throw error;
      for (const r of list(data)) {
        const same = r.parameter === measureKey, had = out[r.site_id];
        if (had && had.same && !same) continue;
        out[r.site_id] = { same, latestText: r.latest_text, latestAt: r.latest_at, unit: r.unit, median: same ? r.median : null, n: same ? r.median_n : 0, key: r.parameter };
      }
    }
    return out;
  }

  // ---- the Water quality page's part: "Enter a round" and the latest rounds, for the group's coordinators --------------------------------
  function entry(group, { sb = FP.sb, compact = false } = {}) {
    const box = el("section", { class: "wqr-entry" + (compact ? " wqr-entry-compact" : ""), hidden: true, "aria-label": "Sampling rounds" });
    if (!M().canEnter(group.role)) return box;
    Promise.all([datasetsOf(sb, group.id), roundsOf(sb, group.id).catch((e) => (missingTable(e) ? null : []))]).then(([sets, rounds]) => {
      if (!sets.length || rounds === null) return;   // no dataset of its own, or rounds not in this database yet
      const names = new Map(sets.map((s) => [s.key, s.name]));
      const go = el("a", { class: "wqr-go", href: FP.href(M().href(group.id)) }, FP.icon ? FP.icon("plus", 16) : null, el("span", {}, "Enter a round"));
      fill(box, el("div", { class: "wqr-entry-head" }, el("h2", {}, "Sampling rounds"), go),
        rounds.length ? el("ul", { class: "wqr-rounds" }, ...rounds.slice(0, compact ? 3 : 5).map((r) => el("li", {},
          el("a", { href: FP.href(M().href(group.id, r.id)) },
            el("span", { class: "wqr-r-title" }, M().dateWords(r.sampled_on, false) + " · " + (M().measure(r.parameter)?.name || r.parameter)),
            el("small", {}, [M().methodName(r.method).toLowerCase(), fmt(r.counts?.values) + " of " + fmt(r.counts?.sites) + " sites", r.counts?.lab_checks ? fmt(r.counts.lab_checks) + (r.counts.lab_checks === 1 ? " lab check" : " lab checks") : "",
              sets.length > 1 ? names.get(r.dataset_key) : ""].filter(Boolean).join(" · ")))))) : el("p", { class: "wqr-quiet" }, "No round entered here yet. A round is typed once and goes straight onto this page."));
      box.hidden = false;
    }, () => {});
    return box;
  }

  // ---- the round --------------------------------------------------------------------------------------------------------------------
  let live = null;
  function view(group, { sb = FP.sb, today = null, roundId = null } = {}) {
    live?.destroy();
    const day = todayIso(today);
    const node = el("section", { class: "wqr", "aria-labelledby": "wqr-title" });
    const status = el("p", { class: "wqr-status", role: "status", "aria-live": "polite" });
    const title = el("h1", { id: "wqr-title", tabindex: "-1" }, roundId ? "Sampling round" : "Enter a round");
    const back = el("a", { class: "wqr-back", href: FP.href(FP.groupModel.href(group.id, "water")) }, FP.icon ? FP.icon("back", 18) : null, el("span", {}, "Water quality"));
    const body = el("div", { class: "wqr-body" });
    node.append(el("header", { class: "wqr-head" }, back, title), status, body);
    let gone = false, st = null, sets = [], sites = [], history = {}, rounds = [], saving = false, timer = null, mode = "edit", savedRow = null;
    let userId = null;
    const key = () => M().draftKey(userId, group.id, roundId);

    const keep = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { if (st && !gone && mode !== "saved") store.set(key(), JSON.stringify({ ...st, keptAt: new Date().toISOString() })); }, 250);
    };
    const keepNow = () => { clearTimeout(timer); if (st && mode !== "saved") store.set(key(), JSON.stringify({ ...st, keptAt: new Date().toISOString() })); };

    async function start() {
      // whose sheet: the signed-in person's own (an earlier version's per-group drafts are cleared, so no one inherits another's)
      try { userId = (await sb.auth.getSession())?.data?.session?.user?.id || null; } catch { userId = null; }
      try { const ls = root.localStorage; for (let i = (ls?.length || 0) - 1; i >= 0; i--) { const k = ls.key(i); if (M().isLegacyDraft(k)) ls.removeItem(k); } } catch { /* nothing kept */ }
      if (!M().canEnter(group.role)) { fill(body, el("p", { class: "wqr-quiet" }, "Only the group's coordinators enter sampling rounds. The group's results are on its Water quality page.")); return; }
      status.textContent = "Loading the group's sites…";
      try {
        sets = await datasetsOf(sb, group.id);
        rounds = await roundsOf(sb, group.id, 60).catch(() => []);
        if (!sets.length) { status.textContent = ""; fill(body, el("p", { class: "wqr-quiet" }, group.name + " has no sampling dataset of its own yet. RCL sets one up with the group's registered sites.")); return; }
        if (roundId) {
          const { data, error } = await sb.from("sampling_rounds").select("*").eq("id", roundId).maybeSingle();
          if (error) throw error;
          if (!data) { status.textContent = ""; fill(body, el("p", { class: "wqr-quiet" }, "That round isn't one you can open.")); return; }
          savedRow = data;
          sites = await sitesOf(sb, data.dataset_key);
          st = M().fromSaved(data, sites);
          const draft = M().draftOf(store.get(key()));
          if (draft && draft.id === data.id && draft.revision === data.revision) { st = { ...st, ...draft, rows: M().rowsFor(sites, draft.rows.map((r) => ({ ...r, not_sampled: r.notSampled }))) }; mode = "edit"; }
          else mode = "saved";
        } else {
          const draft = M().draftOf(store.get(key()));
          const last = rounds[0];
          if (draft && sets.some((s) => s.key === draft.dataset)) st = draft;
          else st = { id: M().newId(), dataset: sets[0].key, sampledOn: day, measureKey: last?.parameter || M().DEFAULT_MEASURE, method: last?.method || "field-sensor",
            lab: last?.method === "laboratory" ? last.lab || "" : "", checkLab: last?.check_lab || "", note: "", revision: null, rows: [] };
          sites = await sitesOf(sb, st.dataset);
          st.rows = M().rowsFor(sites, st.rows.map((r) => ({ ...r, not_sampled: r.notSampled })));
          mode = "edit";
        }
        history = await historyOf(sb, sites, st.measureKey).catch(() => ({}));
      } catch (e) {
        if (gone) return;
        status.textContent = "";
        fill(body, el("p", { class: "wqr-error" }, "Couldn't load the round just now. ", el("button", { type: "button", class: "wqr-link", onclick: () => start() }, "Try again")));
        return;
      }
      if (gone) return;
      status.textContent = "";
      draw();
    }
    function draw() { if (mode === "saved") drawSaved(); else if (mode === "review") drawReview(); else drawSheet(); }
    const measureOf = () => M().measure(st.measureKey);
    const unit = () => measureOf()?.unit || "";
    const datasetName = () => sets.find((s) => s.key === st.dataset)?.name || st.dataset;
    const ctx = () => ({ measureKey: st.measureKey, method: st.method, lab: st.lab, checkLab: st.checkLab, history, sampledOn: st.sampledOn, today: day });

    // ---- the sheet --------------------------------------------------------------------------------------------------------------
    function drawSheet() {
      title.textContent = st.revision ? "Correct the round of " + M().dateWords(st.sampledOn) : "Enter a round";
      const R = FP.formRows, fixed = !!st.revision;
      const head = [];
      if (sets.length > 1 && !fixed) head.push(R.pick({ id: "wqr-dataset", label: "Dataset", options: sets.map((s) => ({ value: s.key, label: s.name })), value: () => st.dataset,
        onPick: async (v) => { if (v === st.dataset) return; st.dataset = v; status.textContent = "Loading the sites…"; sites = await sitesOf(sb, v).catch(() => []); st.rows = M().rowsFor(sites, []); history = await historyOf(sb, sites, st.measureKey).catch(() => ({})); status.textContent = ""; keep(); drawSheet(); } }));
      else if (sets.length > 1) head.push(R.row({ label: "Dataset", control: el("span", { class: "wqr-fixed" }, datasetName()) }));
      if (fixed) {
        head.push(R.row({ label: "Date", control: el("span", { class: "wqr-fixed" }, M().dateWords(st.sampledOn)) }),
          R.row({ label: "Measure", control: el("span", { class: "wqr-fixed" }, (measureOf()?.long || st.measureKey) + ", " + unit()) }),
          R.row({ label: "Method", control: el("span", { class: "wqr-fixed" }, M().methodName(st.method)) }));
      } else {
        head.push(R.text({ id: "wqr-date", label: "Date", type: "date", value: st.sampledOn, attrs: { max: day }, onInput: (v) => { st.sampledOn = v; keep(); dup(); } }),
          R.pick({ id: "wqr-measure", label: "Measure", options: M().MEASURES.map((m) => ({ value: m.key, label: m.long + ", " + m.unit })), value: () => st.measureKey,
            onPick: async (v) => { st.measureKey = v; history = await historyOf(sb, sites, v).catch(() => ({})); keep(); drawSheet(); } }),
          R.pick({ id: "wqr-method", label: "Method", options: M().METHODS.map((m) => ({ value: m.key, label: m.name })), value: () => st.method,
            onPick: (v) => { st.method = v; keep(); drawSheet(); } }));
      }
      if (st.method === "laboratory") head.push(R.text({ id: "wqr-lab", label: "Laboratory", value: st.lab, placeholder: "The laboratory's name", max: 80, onInput: (v) => { st.lab = v; keep(); } }));
      else head.push(R.text({ id: "wqr-checklab", label: "Checks sent to", value: st.checkLab, placeholder: "Laboratory, if any went", max: 80, onInput: (v) => { st.checkLab = v; keep(); recheck(); } }));
      const dupNote = el("p", { class: "wqr-dup", role: "status" });
      function dup() {
        const id = !st.revision && M().sameRound(rounds, st);
        fill(dupNote, id ? ["A round of this measure on that day is already saved. ", el("a", { href: FP.href(M().href(group.id, id)) }, "Open it to correct it")] : []);
      }
      dup();

      const checks = st.method !== "laboratory";
      const cols = ["value", ...(checks ? ["check"] : []), "ns", "note"];
      const tbody = el("tbody", {});
      const inputs = {};   // column -> [inputs by row]
      for (const c of cols) inputs[c] = [];
      st.rows.forEach((r, i) => {
        const s = sites.find((x) => x.id === r.site_id) || { name: "Site " + r.site_id };
        const h = history[r.site_id];
        const label = s.name || s.external_id;
        const val = el("input", { class: "wqr-in", type: "text", inputmode: "decimal", autocomplete: "off", "aria-label": "This round, " + label, placeholder: unit(), "data-col": "value", "data-row": i });
        val.value = r.value;
        const chk = checks ? el("input", { class: "wqr-in wqr-in-check", type: "text", inputmode: "decimal", autocomplete: "off", "aria-label": "Laboratory check, " + label, placeholder: "Lab check", "data-col": "check", "data-row": i }) : null;
        if (chk) chk.value = r.check;
        const ns = el("input", { type: "checkbox", class: "wqr-ns", "aria-label": "Not sampled, " + label, "data-col": "ns", "data-row": i, ...(r.notSampled ? { checked: true } : {}) });
        const note = el("input", { class: "wqr-in wqr-in-note", type: "text", autocomplete: "off", maxlength: "500", placeholder: "Note", "aria-label": "Note, " + label, "data-col": "note", "data-row": i });
        note.value = r.note;
        inputs.value.push(val); if (chk) inputs.check.push(chk); inputs.ns.push(ns); inputs.note.push(note);
        val.addEventListener("input", () => { r.value = val.value; if (val.value.trim() && r.notSampled) { r.notSampled = false; ns.checked = false; } keep(); recheck(i); });
        chk?.addEventListener("input", () => { r.check = chk.value; keep(); recheck(i); });
        ns.addEventListener("change", () => { r.notSampled = ns.checked; keep(); recheck(i); });
        note.addEventListener("input", () => { r.note = note.value; keep(); recheck(i); });
        const msg = el("p", { class: "wqr-msg", id: "wqr-msg-" + i });
        // the last result of the measure; of another key of its family (nitrate-nitrite-N for nitrate-N) only with that key named
        const other = h && !h.same && h.key ? " · " + (M().measure(h.key)?.name || h.key) : "";
        const last = h?.latestText != null ? el("span", { class: "wqr-last" }, h.latestText, el("small", {}, M().dateWords(String(h.latestAt || "").slice(0, 10), false) + other)) : el("span", { class: "wqr-last wqr-none" }, "–");
        tbody.append(el("tr", { "data-site": r.site_id, "data-row": i },
          el("th", { scope: "row" }, el("span", { class: "wqr-site" }, label), s.name && s.external_id && s.external_id !== s.name ? el("small", {}, s.external_id) : null),
          el("td", { class: "wqr-c-last" }, last),
          el("td", { class: "wqr-c-val" }, val),
          checks ? el("td", { class: "wqr-c-check" }, chk) : null,
          el("td", { class: "wqr-c-ns" }, el("label", {}, ns, el("span", {}, "Not sampled"))),
          el("td", { class: "wqr-c-note" }, note)),
          // a message about the row: a plain sentence on its own line under it, the table's full width
          el("tr", { class: "wqr-msgrow", "data-for": i, hidden: true }, el("td", { colspan: String(cols.length + 2) }, msg)));
      });
      // keyboard: Tab and Enter move down the column (Shift: up); at a column's end, Tab goes on to the top of the next
      tbody.addEventListener("keydown", (e) => {
        const t = e.target, col = t?.dataset?.col, i = Number(t?.dataset?.row);
        if (!col || !Number.isFinite(i) || e.altKey || e.ctrlKey || e.metaKey) return;
        if (e.key !== "Tab" && !(e.key === "Enter" && t.type !== "checkbox")) return;
        const n = st.rows.length, c = cols.indexOf(col), up = e.shiftKey;
        let to = null;
        if (e.key === "Enter") to = inputs[col][up ? i - 1 : i + 1] || null;
        else if (!up) to = inputs[col][i + 1] || (cols[c + 1] ? inputs[cols[c + 1]][0] : null);
        else to = inputs[col][i - 1] || (cols[c - 1] ? inputs[cols[c - 1]][n - 1] : null);
        if (e.key === "Enter" && !to && !up) { e.preventDefault(); reviewBtn.focus(); return; }
        if (!to) return;
        e.preventDefault(); to.focus(); to.select?.();
        to.closest("tr")?.scrollIntoView?.({ block: "nearest" });
      });
      // a column pasted from a spreadsheet fills down from the box it was pasted in (a second column goes into the checks)
      tbody.addEventListener("paste", (e) => {
        const t = e.target, col = t?.dataset?.col, i = Number(t?.dataset?.row);
        if (col !== "value" && col !== "check") return;
        const cells = M().pasted(e.clipboardData?.getData("text/plain"));
        if (!cells) return;
        e.preventDefault();
        const n = M().fillDown(st.rows, i, col, cells, { withCheck: checks });
        st.rows.forEach((r, j) => { inputs.value[j].value = r.value; if (checks) inputs.check[j].value = r.check; inputs.ns[j].checked = !!r.notSampled; });
        keep(); recheck();
        const end = inputs[col][Math.min(i + cells.length, st.rows.length - 1)];
        end?.focus();
        status.textContent = "Filled " + n + (n === 1 ? " row" : " rows") + " from the paste" + (cells.length > st.rows.length - i ? "; " + (cells.length - (st.rows.length - i)) + " more than the sites listed were left out" : "") + ".";
      });

      const table = el("table", { class: "wqr-table" },
        el("caption", { class: "visually-hidden" }, "The round's sites: " + fmt(st.rows.length)),
        el("thead", {}, el("tr", {}, el("th", { scope: "col" }, "Site"), el("th", { scope: "col", class: "wqr-c-last" }, "Last result"),
          el("th", { scope: "col", class: "wqr-c-val" }, "This round", el("small", {}, unit())),
          checks ? el("th", { scope: "col", class: "wqr-c-check" }, "Lab check", el("small", {}, "optional")) : null,
          el("th", { scope: "col", class: "wqr-c-ns" }, el("span", { class: "visually-hidden" }, "Not sampled")), el("th", { scope: "col", class: "wqr-c-note" }, "Note"))),
        tbody);
      const counts = el("p", { class: "wqr-counts", "aria-live": "polite" });
      const sheetMsg = el("div", { class: "wqr-sheetmsg", role: "alert" });
      const reviewBtn = el("button", { type: "button", class: "primary wqr-primary", onclick: () => toReview() }, "Review");
      const discard = el("button", { type: "button", class: "wqr-link", onclick: () => {
        store.drop(key());
        if (st.revision && savedRow) { st = M().fromSaved(savedRow, sites); mode = "saved"; draw(); return; }
        st = { ...st, id: M().newId(), rows: M().rowsFor(sites, []), note: "" }; drawSheet(); status.textContent = "Cleared.";
      } }, st.revision ? "Cancel the corrections" : "Clear the sheet");
      const kept = el("span", { class: "wqr-kept" }, "Kept on this computer until it is saved");
      fill(body,
        el("div", { class: "wqr-headset fs-sheet" }, R.set(...head), dupNote),
        el("div", { class: "wqr-help" }, el("p", {}, "Type each site's result. ", el("b", {}, "Tab"), " or ", el("b", {}, "Enter"), " moves down the column; paste a column from a spreadsheet into the first box to fill it down. Write a result below the detection limit like ", el("b", {}, "<0.05"), "."),
          el("p", {}, "A round entered here is the group's record of it: don't also import the same readings from a spreadsheet, or each would count twice.")),
        el("div", { class: "wqr-tablewrap" }, table),
        el("div", { class: "wqr-foot" }, el("div", { class: "wqr-foot-words" }, counts, kept, sheetMsg), el("div", { class: "wqr-foot-actions" }, discard, reviewBtn)));
      let shown = false;
      function recheck(only = null) {
        const c = M().check(st.rows, ctx());
        const s = M().summary(st.rows, { sites, ...ctx() });
        counts.textContent = fmt(s.entered) + " of " + fmt(s.sites) + " sites entered" + (s.notSampled ? " · " + fmt(s.notSampled) + " not sampled" : "") + (s.labChecks ? " · " + fmt(s.labChecks) + (s.labChecks === 1 ? " lab check" : " lab checks") : "");
        st.rows.forEach((r, i) => {
          if (only != null && i !== only && !shown) return;
          const m = c.rows.get(r.site_id) || { errors: [], warnings: [] };
          const words = [...m.errors, ...m.warnings].join(". ");
          const p = body.querySelector("#wqr-msg-" + i);
          if (p) { p.textContent = words; p.className = "wqr-msg" + (m.errors.length ? " wqr-bad" : m.warnings.length ? " wqr-warn" : ""); p.closest("tr").hidden = !words; }
          for (const inp of [inputs.value[i], inputs.check?.[i]]) if (inp) { inp.setAttribute("aria-invalid", String(!!m.errors.length)); if (words) inp.setAttribute("aria-describedby", "wqr-msg-" + i); else inp.removeAttribute("aria-describedby"); }
        });
        if (shown) fill(sheetMsg, c.sheet.map((x) => el("p", {}, x)));
        return c;
      }
      function toReview() {
        shown = true;
        const c = recheck();
        if (c.errors) {
          fill(sheetMsg, [...c.sheet.map((x) => el("p", {}, x)), c.errors - c.sheet.length ? el("p", {}, (c.errors - c.sheet.length) + (c.errors - c.sheet.length === 1 ? " row needs" : " rows need") + " fixing first.") : null]);
          const first = st.rows.findIndex((r) => c.rows.get(r.site_id)?.errors.length);
          if (first >= 0) inputs.value[first].focus();
          return;
        }
        if (!st.revision && M().sameRound(rounds, st)) { fill(sheetMsg, el("p", {}, "A round of this measure on that day is already saved: open it from the Water quality page to correct it.")); return; }
        keepNow(); mode = "review"; draw(); title.focus();
      }
      recheck();
      st.rows.forEach((r, i) => { if (r.value || r.check || r.note) recheck(i); });
    }

    // ---- review and save ------------------------------------------------------------------------------------------------------------
    function figures(s) {
      const line = (label, value) => el("div", { class: "wqr-fig" }, el("dt", {}, label), el("dd", {}, value));
      const u = s.unit ? " " + s.unit : "";
      return el("dl", { class: "wqr-figs" },
        line("Sites sampled", fmt(s.entered) + " of " + fmt(s.sites)),
        line("Not sampled", fmt(s.notSampled) + (s.blank ? " (and " + fmt(s.blank) + " left blank)" : "")),
        line("Laboratory checks", fmt(s.labChecks) + (s.labChecks && s.checkLab ? " to " + s.checkLab : "")),
        line("Highest", s.highest ? s.highest.text + u + ", " + s.highest.name : "–"),
        line("Median", s.median == null ? "–" : s.median + u),
        line("Range", s.low == null ? "–" : s.low === s.high ? s.low + u : s.low + " to " + s.high + u));
    }
    function unusualList(s) {
      return s.unusual.length ? el("div", { class: "wqr-unusual" }, el("h2", {}, "Worth a second look"),
        el("ul", { class: "wqr-list" }, ...s.unusual.map((u) => el("li", {}, el("b", {}, u.name), el("span", {}, u.text + " " + s.unit + " · " + u.why))))) : null;
    }
    function drawReview() {
      const s = M().summary(st.rows, { sites, ...ctx() });
      title.textContent = "Review the round";
      const err = el("div", { class: "wqr-sheetmsg", role: "alert" });
      const save = el("button", { type: "button", class: "primary wqr-primary", onclick: () => doSave(save, err) }, st.revision ? "Save corrections" : "Save round");
      fill(body,
        el("p", { class: "wqr-lead" }, M().dateWords(st.sampledOn) + " · " + (measureOf()?.long || st.measureKey) + " by " + M().methodName(st.method).toLowerCase() + (st.method === "laboratory" && st.lab ? " (" + st.lab + ")" : "") + (sets.length > 1 ? " · " + datasetName() : "")),
        figures(s), unusualList(s),
        el("p", { class: "wqr-quiet" }, "Don't also import these readings from a spreadsheet: they would count twice."),
        el("p", { class: "wqr-quiet" }, st.revision ? "Saving keeps every earlier value: a changed result keeps the one it replaces, and a result taken out is marked replaced, never deleted." : "Saving puts the results on the group's Water quality page, where the group's members see them as they see its other results."),
        el("div", { class: "wqr-foot" }, el("div", { class: "wqr-foot-words" }, err),
          el("div", { class: "wqr-foot-actions" }, el("button", { type: "button", class: "wqr-link", onclick: () => { mode = "edit"; draw(); } }, "Back to the sheet"), save)));
    }
    async function doSave(btn, err) {
      if (saving) return;
      saving = true; btn.disabled = true; btn.textContent = "Saving…"; fill(err);
      keepNow();
      const args = { p_round: st.id, p_dataset: st.dataset, p_sampled_on: st.sampledOn, p_parameter: st.measureKey, p_method: st.method,
        p_lab: st.method === "laboratory" ? st.lab : "", p_check_lab: st.method === "laboratory" ? "" : st.checkLab, p_entries: M().payload(st.rows, { method: st.method }),
        p_expected_revision: st.revision || null, p_note: st.note || null };
      let res;
      try {
        const { data, error } = await sb.rpc("sampling_round_save", args);
        if (error) throw error;
        res = data;
      } catch (e) {
        saving = false;
        if (gone) return;
        btn.disabled = false; btn.textContent = st.revision ? "Save corrections" : "Save round";
        fill(err, el("p", {}, M().errorWords(e)));
        return;
      }
      saving = false;
      mode = "saved";   // (nothing is kept as a draft from here: leaving the screen must not write the saved sheet back)
      clearTimeout(timer);
      store.drop(key());
      if (!roundId) store.drop(M().draftKey(userId, group.id));
      FP.wqPage?.forget?.(group.id);
      if (gone) return;
      const to = M().href(group.id, res?.round_id || st.id);
      const said = res?.unchanged ? "Nothing had changed: the round was already saved." : st.revision ? "Corrections saved." : "Round saved.";
      if (roundId && roundId === (res?.round_id || st.id)) { await reopen(said); return; }
      FP.wqRound.notice = said;
      root.location.hash = FP.href(to);
    }
    async function reopen(said) {
      const { data } = await sb.from("sampling_rounds").select("*").eq("id", st.id).maybeSingle();
      if (gone) return;
      if (data) { savedRow = data; st = M().fromSaved(data, sites); }
      history = await historyOf(sb, sites, st.measureKey).catch(() => history);
      mode = "saved"; draw(); status.textContent = said || "";
    }

    // ---- a saved round -------------------------------------------------------------------------------------------------------------
    function drawSaved() {
      const s = M().summary(st.rows, { sites, ...ctx() });
      title.textContent = "Round of " + M().dateWords(st.sampledOn);
      const text = M().reportText(s, { group: group.name, dataset: sets.length > 1 ? datasetName() : "", sampledOn: st.sampledOn });
      const pre = el("pre", { class: "wqr-report", tabindex: "0", "aria-label": "Text for the monthly report" }, text);
      const copied = el("span", { class: "wqr-quiet", role: "status" });
      const copy = el("button", { type: "button", class: "wqr-quietbtn", onclick: async () => {
        let ok = false;
        try { await root.navigator.clipboard.writeText(text); ok = true; } catch { /* below */ }
        if (!ok) { try { const r = document.createRange(); r.selectNodeContents(pre); const sel = root.getSelection(); sel.removeAllRanges(); sel.addRange(r); ok = document.execCommand?.("copy"); } catch { ok = false; } }
        copied.textContent = ok ? "Copied" : "Select the text and copy it";
      } }, "Copy");
      const rowsOut = st.rows.filter((r) => r.value || r.check || r.notSampled || r.note);
      const siteName = (id) => { const x = sites.find((y) => y.id === id); return x?.name || x?.external_id || "Site " + id; };
      fill(body,
        el("p", { class: "wqr-lead" }, (measureOf()?.long || st.measureKey) + " by " + M().methodName(st.method).toLowerCase() + (st.method === "laboratory" && st.lab ? " (" + st.lab + ")" : "") + (sets.length > 1 ? " · " + datasetName() : "") +
          (savedRow?.revision > 1 ? " · corrected " + (savedRow.revision - 1) + (savedRow.revision === 2 ? " time" : " times") : "")),
        figures(s), unusualList(s),
        el("div", { class: "wqr-reportbox" }, el("div", { class: "wqr-reporthead" }, el("h2", {}, "For the monthly report"), el("span", {}, copied, copy)), pre),
        el("div", { class: "wqr-results" }, el("h2", {}, "Results"),
          el("ul", { class: "wqr-list" }, ...rowsOut.map((r) => el("li", {}, el("b", {}, siteName(r.site_id)),
            el("span", { class: "wqr-res" }, r.notSampled ? "not sampled" : [r.value ? r.value + " " + unit() : "", r.check ? "lab " + r.check : ""].filter(Boolean).join(" · ")),
            r.note ? el("small", {}, r.note) : null)))),
        el("div", { class: "wqr-foot" }, el("div", { class: "wqr-foot-words" }, el("p", { class: "wqr-quiet" }, "On the Water quality page for the group's members. Corrections keep the earlier values.")),
          el("div", { class: "wqr-foot-actions" }, el("a", { class: "wqr-link", href: FP.href(FP.groupModel.href(group.id, "water")) }, "Back to Water quality"),
            el("button", { type: "button", class: "primary wqr-primary", onclick: () => { st.revision = savedRow?.revision || st.revision; mode = "edit"; draw(); title.focus(); } }, "Correct values"))));
    }

    start().then(() => { if (FP.wqRound.notice) { status.textContent = FP.wqRound.notice; FP.wqRound.notice = null; } });
    const api = { node, destroy() { if (!gone) keepNow(); gone = true; clearTimeout(timer); if (live === api) live = null; }, state: () => st };
    node.wqr = api;
    live = api;
    return node;
  }

  FP.wqRound = { view, entry, close: () => live?.destroy(), notice: null };
})(typeof window === "undefined" ? globalThis : window);
