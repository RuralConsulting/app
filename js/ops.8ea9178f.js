// The Operations page (#/ops), for RCL staff only: the data jobs, the reference sources, what each group load set aside
// (DQ1), the AI's how-to recipes, the AI evaluation (EV1), the onboarding effort (MC3) and the build, on one screen. The one thing it changes is a recipe's status (Approve / Retire, a platform advisor's, confirmed
// first; AI1); everything else is read only, and "Run workflow" is a link to GitHub. Row-level security on the ops views
// and on ai_recipes is the real gate; hiding the link for everyone else is a courtesy.
(function () {
  const M = FP.opsModel, { $, $$, el, sb } = FP;
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const ext = (href, label) => href ? '<a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + esc(label) + "</a>" : "";
  let staff = false, token = 0, me = null;

  // Whether this sign-in is RCL staff (profiles.is_staff, readable by its owner). Anything unexpected means not staff.
  async function checkStaff(user) {
    me = user || null;
    try {
      const { data, error } = await sb.from("profiles").select("is_staff").eq("user_id", user.id).maybeSingle();
      staff = !error && data?.is_staff === true;
    } catch { staff = false; }
    showLinks();
    return staff;
  }
  // The Operations links as the staff flag says (again once the farm space's header is made: PERF1b reads the flag
  // beside the farms, so it may be known first).
  function showLinks() {
    for (const a of $$(".ops-link")) { a.hidden = !staff; for (const n of $$("a", a)) n.setAttribute("href", FP.href("#/ops")); }
    const header = $("#space-ops");
    if (header) header.setAttribute("href", FP.href("#/ops"));
    $("#ops-looks-tab")?.setAttribute("href", FP.href("#/ops/looks"));   // LK2: Layer looks, beside Layers
  }

  const badge = (j) => '<span class="ops-badge" data-health="' + esc(j.health) + '">' + esc(j.badge) + "</span>";
  function jobItem(j, promoted) {
    const lines = promoted ? [] : [j.success + (j.next ? " · " + j.next : ""), j.last + (j.category ? " · " + j.category : "")];
    const acts = [ext(j.runUrl, "Open the run"), ext(j.workflowUrl, "Run workflow"), j.commit ? ext(j.commitUrl, "Commit " + j.commit) : ""].filter(Boolean);
    return '<li class="ops-job" data-job="' + esc(j.key) + '" data-health="' + esc(j.health) + '"><div class="ops-job-head"><b>' + esc(j.title) + "</b>" + badge(j) + "</div>" +
      (promoted ? '<p class="ops-line">' + esc(j.because) + "</p>" : lines.map((l) => '<p class="ops-line">' + esc(l) + "</p>").join("")) +
      (j.counts.length && !promoted ? '<p class="ops-line ops-counts">' + j.counts.map(esc).join(" · ") + "</p>" : "") +
      (j.note ? '<p class="ops-line ops-note">' + esc(j.note) + "</p>" : "") +
      (acts.length ? '<p class="ops-links">' + acts.join(" ") + "</p>" : "") + "</li>";
  }
  function jobsPanel(v) {
    const sentence = v.answer ? v.answer.text + " — " + v.answer.because : v.empty;
    const top = v.attention.slice(0, 3);
    const rest = v.groups.map((g) => '<section class="ops-group" data-group="' + esc(g.key) + '"><h3>' + esc(g.name) + " (" + g.items.length + ')</h3><ul class="ops-list">' +
      g.items.map((j) => jobItem(j, false)).join("") + "</ul></section>").join("");
    return '<section class="answer-panel answer-compact ops-panel" data-ops="jobs" data-answer-state="' + (v.answer ? "recorded" : "empty") + '"><h2>' + esc(v.title) + '</h2><p class="answer-sentence">' + esc(sentence) + "</p>" +
      (top.length ? '<ul class="ops-list ops-promoted">' + top.map((j) => jobItem(j, true)).join("") + "</ul>" : "") +
      (v.items.length ? '<details class="answer-all"' + (v.attention.length > 3 ? " open" : "") + "><summary>All jobs (" + v.items.length + ")</summary>" + rest + "</details>" : "") + "</section>";
  }
  function refItem(r) {
    return '<li class="ops-job" data-source="' + esc(r.key) + '"' + (r.rights ? ' data-rights="changed"' : "") + '><div class="ops-job-head"><b>' + esc(r.title) + "</b></div>" +
      '<p class="ops-line">' + [r.licence, r.served, r.refreshed, r.features].filter(Boolean).map(esc).join(" · ") + "</p>" +
      (r.flag ? '<p class="ops-line ops-note">' + esc(r.flag) + "</p>" : "") + (r.lastPull ? '<p class="ops-line">' + esc(r.lastPull) + "</p>" : "") + "</li>";
  }
  function referencesPanel(v) {
    const sentence = v.answer ? v.answer.text + " — " + v.answer.because : v.empty;
    const top = v.attention.slice(0, 3);
    return '<section class="answer-panel answer-compact ops-panel" data-ops="references" data-answer-state="' + (v.answer ? "recorded" : "empty") + '"><h2>' + esc(v.title) + '</h2><p class="answer-sentence">' + esc(sentence) + "</p>" +
      (top.length ? '<ul class="ops-list ops-promoted">' + top.map(refItem).join("") + "</ul>" : "") +
      (v.items.length ? '<details class="answer-all"><summary>All sources (' + v.items.length + ')</summary><ul class="ops-list">' + v.items.map(refItem).join("") + "</ul></details>" : "") + "</section>";
  }
  // drawn: PERF1b's `farm-drawn` line for this browser (M.drawnLine), beside the version; none when there is no figure.
  // groupDrawn: PERF3b's `group-drawn` line, beside it. steps: TIM1's per-step lines (M.stepsLine), { farm, group }, each
  // under its drawn line.
  function buildPanel(b, drawn, groupDrawn = null, steps = {}) {
    const stepLine = (line, measure) => (line ? '<p class="ops-line ops-timing ops-steps" data-ops-steps="' + measure + '">' + esc(line) + "</p>" : "");
    return '<section class="answer-panel answer-compact ops-panel" data-ops="build"><h2>Build</h2><p class="answer-sentence">' + esc(b.answer.text) + " — " + esc(b.answer.because) + "</p>" +
      (drawn ? '<p class="ops-line ops-timing" data-ops-measure="farm-drawn">' + esc(drawn) + "</p>" + stepLine(steps?.farm, "farm-drawn") : "") +
      (groupDrawn ? '<p class="ops-line ops-timing" data-ops-measure="group-drawn">' + esc(groupDrawn) + "</p>" + stepLine(steps?.group, "group-drawn") : "") +
      '<ul class="ops-linklist">' + b.links.map(([label, href]) => "<li>" + ext(href, label) + "</li>").join("") +
      (b.commitUrl ? "<li>" + ext(b.commitUrl, "This version's commit") + "</li>" : "") + "</ul></section>";
  }

  // Group data completeness (DQ1): per group, a line per kind with what would resolve it, then (group admins and staff) the
  // list by member and the items no id ties to anyone. Nothing here links anything: it shows what the load set aside.
  function gapItem(i) {
    return '<li class="ops-job" data-gap-item="' + esc(i.kind) + '"><div class="ops-job-head"><b>' + esc(i.who) + '</b><span class="ops-badge">' + esc(i.what) + "</span></div>" +
      '<p class="ops-line">' + [i.reason, i.count, i.source].filter(Boolean).map(esc).join(" · ") + "</p>" +
      (i.files.length ? '<details class="ops-steps"><summary>' + (i.files.length === 1 ? "The file" : "The files (" + i.files.length + ")") + '</summary><ul class="ops-list">' +
        i.files.map((f) => '<li class="ops-line">' + esc(f) + "</li>").join("") + "</ul></details>" : "") + "</li>";
  }
  function gapGroup(g) {
    const list = (title, items) => items.length ? '<details class="answer-all"><summary>' + esc(title) + " (" + items.length + ')</summary><ul class="ops-list">' + items.map(gapItem).join("") + "</ul></details>" : "";
    return '<section class="ops-group" data-gap-group="' + esc(g.id) + '"><h3>' + esc(g.name) + (g.checked ? " · load of " + esc(g.checked) : "") + "</h3>" +
      (g.lines.length ? '<ul class="ops-list ops-promoted">' + g.lines.map((l) => '<li class="ops-job" data-gap="' + esc(l.kind) + '"><div class="ops-job-head"><b>' + esc(l.text) + "</b></div>" +
        '<p class="ops-line">To resolve: ' + esc(l.resolve) + "</p></li>").join("") + "</ul>" : '<p class="ops-line">The last load set nothing aside.</p>') +
      (g.detail ? list("By member", g.members) + list("Not tied to any member", g.unlinked)
        : g.lines.length ? '<p class="ops-line">Counts only: the group\'s admins see which members and files.</p>' : "") + "</section>";
  }
  function gapsPanel(v) {
    if (!v) return '<section class="answer-panel answer-compact ops-panel" data-ops="gaps"><h2>Group data completeness</h2><p class="answer-sentence" role="alert">Couldn\'t read the group load gaps.</p></section>';
    const sentence = v.answer ? v.answer.text + " — " + v.answer.because : v.empty;
    return '<section class="answer-panel answer-compact ops-panel" data-ops="gaps" data-answer-state="' + (v.answer ? "recorded" : "empty") + '"><h2>' + esc(v.title) +
      '</h2><p class="answer-sentence">' + esc(sentence) + "</p>" + v.groups.map(gapGroup).join("") + "</section>";
  }
  // The hook for the group's own space (S5): the same panel for one group, read as the signed-in person (the database decides
  // detail for the group's admins, counts for its other members, nothing for anyone else). Returns the view, or null.
  async function groupGaps(el, groupId) {
    let v = null;
    try { v = M.loadGaps(await read(sb.rpc("group_load_gaps", { group_id: groupId || null }))); } catch { v = null; }
    if (!el) return v;
    el.innerHTML = v && !v.groups.length ? "" : gapsPanel(v);
    return v;
  }

  // AI recipes (AI1): every version, newest first under its key; Approve / Retire for a platform advisor only.
  const actWord = { approve: "Approve", retire: "Retire" };
  function recipeVersionItem(v) {
    return '<li class="ops-job" data-recipe="' + esc(v.key) + '" data-status="' + esc(v.status) + '"><div class="ops-job-head"><b>' + esc(v.title) +
      (v.version !== null ? " · v" + esc(v.version) : "") + '</b><span class="ops-badge" data-recipe-status="' + esc(v.status) + '">' + esc(v.badge) + "</span></div>" +
      (v.when ? '<p class="ops-line">' + esc(v.when) + "</p>" : "") +
      '<p class="ops-line">' + esc([v.author, v.decided].filter(Boolean).join(" · ")) + "</p>" +
      (v.unverified ? '<p class="ops-line ops-note">Method not yet verified.</p>' : "") +
      (v.tags.length ? '<p class="ops-line ops-counts">' + v.tags.map(esc).join(" · ") + "</p>" : "") +
      (v.steps.length ? '<details class="ops-steps"><summary>Steps (' + v.steps.length + ')</summary><ol class="ops-list">' +
        v.steps.map((s) => '<li class="ops-line">' + esc(s) + "</li>").join("") + "</ol></details>" : "") +
      (v.actions.length ? '<p class="ops-links">' + v.actions.map((a) => '<button type="button" class="link ops-recipe-act" data-recipe-id="' + esc(v.id) +
        '" data-act="' + esc(a) + '">' + esc(actWord[a]) + "</button>").join(" ") + "</p>" : "") + "</li>";
  }
  function recipesPanel(v) {
    if (!v) return '<section class="answer-panel answer-compact ops-panel" data-ops="recipes"><h2>AI recipes</h2><p class="answer-sentence" role="alert">Couldn\'t read the recipes.</p></section>';
    const sentence = v.answer ? v.answer.text + " — " + v.answer.because : v.empty;
    return '<section class="answer-panel answer-compact ops-panel" data-ops="recipes" data-answer-state="' + (v.answer ? "recorded" : "empty") + '"><h2>' + esc(v.title) +
      '</h2><p class="answer-sentence">' + esc(sentence) + "</p>" + (v.canDecide ? "" : '<p class="ops-line">Read only: a platform advisor approves or retires a recipe.</p>') +
      '<p class="ops-line ops-recipe-msg" role="status"></p>' +
      (v.items.length ? '<details class="answer-all"' + (v.items.some((i) => i.drafts) ? " open" : "") + "><summary>All recipes (" + v.items.length + ")</summary>" +
        v.items.map((i) => '<section class="ops-group" data-recipe-key="' + esc(i.key) + '"><h3>' + esc(i.key) + '</h3><ul class="ops-list">' +
          i.versions.map(recipeVersionItem).join("") + "</ul></section>").join("") + "</details>" : "") + "</section>";
  }
  const RECIPE_COLUMNS = "id,key,version,title,when_to_use,tags,steps,status,author_kind,author_model,created_at,approved_at,retired_at,retire_reason";
  // Approve or retire one version, as the signed-in person (row-level security and the database's guard decide), then read again.
  async function decide(button) {
    const id = button.getAttribute("data-recipe-id"), act = button.getAttribute("data-act"), msg = $(".ops-recipe-msg");
    if (!id || !actWord[act]) return;
    const ask = act === "approve" ? "Approve this recipe? The AI will use it from the next question." : "Retire this recipe? The AI will stop using it.";
    if (typeof window.confirm === "function" && !window.confirm(ask)) return;
    button.disabled = true;
    try {
      const { error } = await sb.from("ai_recipes").update({ status: act === "approve" ? "approved" : "retired" }).eq("id", id);
      if (error) throw error;
      await open();
    } catch (e) {
      button.disabled = false;
      if (msg) msg.textContent = "Couldn't " + act + " that recipe: " + (e?.message || e);
    }
  }
  // AI evaluation (EV1): per flow, the proposals made, accepted and dismissed, corrections per 100 accepted and the AI cost, for a
  // chosen period, from public.ai_ratchet_evaluation (counts only). A figure the records do not hold says "not recorded yet" and,
  // under "What would record it", what would; nothing is estimated.
  let ratchetKey = "30d";
  const dot = (t) => /[.!?]$/.test(t) ? t : t + ".";
  function flowItem(f) {
    return '<li class="ops-job" data-flow="' + esc(f.key) + '"><div class="ops-job-head"><b>' + esc(f.name) + "</b></div>" +
      '<dl class="ops-figures">' + f.cells.map((c) => '<div data-figure="' + esc(c.key) + '"' + (c.recorded ? "" : ' data-recorded="no"') + "><dt>" + esc(c.label) + "</dt><dd>" +
        (c.recorded ? esc(c.text) : '<span class="ops-gap">not recorded yet</span>') + "</dd></div>").join("") + "</dl>" +
      f.detail.map((l) => '<p class="ops-line">' + esc(l) + "</p>").join("") +
      (f.gaps.length ? '<details class="ops-steps"><summary>What would record the missing figures (' + f.gaps.length + ')</summary><ul class="ops-list">' +
        f.gaps.map((g) => '<li class="ops-line" data-gap-for="' + esc(g.what) + '"><b>' + esc(g.what) + ":</b> " + esc(dot(g.why)) + " Would record it: " + esc(dot(g.would)) + "</li>").join("") + "</ul></details>" : "") + "</li>";
  }
  function ratchetPanel(v, period) {
    const p = period || M.ratchetPeriod(ratchetKey);
    const picker = '<p class="ops-line"><label>Period <select id="ops-ratchet-period">' + p.options.map((o) =>
      '<option value="' + esc(o.key) + '"' + (o.key === p.key ? " selected" : "") + ">" + esc(o.label) + "</option>").join("") + "</select></label></p>";
    if (!v) return '<section class="answer-panel answer-compact ops-panel" data-ops="ai-evaluation"><h2>AI evaluation</h2>' + picker + '<p class="answer-sentence" role="alert">Couldn\'t read the AI evaluation.</p></section>';
    return '<section class="answer-panel answer-compact ops-panel" data-ops="ai-evaluation" data-answer-state="recorded"><h2>' + esc(v.title) + '</h2><p class="answer-sentence">' +
      esc(v.answer.text + " — " + v.answer.because) + "</p>" + picker + '<ul class="ops-list">' + v.flows.map(flowItem).join("") + "</ul>" +
      '<p class="ops-line" data-ai-total>' + esc(v.total.text + (v.total.purposes.length ? " (" + v.total.purposes.map((x) => x.purpose + " " + x.calls).join(", ") + ")" : "") + ".") + "</p>" +
      '<p class="ops-line" data-eval>' + esc(v.evaluation.text) + " " + ext(v.evaluation.url, "Latest CI runs") + "</p></section>";
  }
  async function readRatchet() {
    const p = M.ratchetPeriod(ratchetKey);
    let raw = null;
    try { raw = await read(sb.rpc("ai_ratchet_evaluation", { p_from: p.from, p_to: p.to })); } catch { raw = null; }
    return ratchetPanel(M.ratchet(raw, p), p);
  }
  async function changePeriod(select) {
    ratchetKey = select.value;
    const panel = $('[data-ops="ai-evaluation"]'), current = token;
    if (!panel) return;
    const html = await readRatchet();
    if (current !== token || !panel.isConnected) return;
    panel.outerHTML = html;
    $("#ops-ratchet-period")?.focus();
  }

  // Onboarding effort (MC3): per farm and per catchment group (and overall) for a chosen period, ON1's effort records summed and
  // A14a's reconciliation outcomes, from public.onboarding_effort_rollup (numbers only). "Not recorded yet" and what would record
  // it, never an estimate. Reads only.
  let onboardingKey = "30d";
  const figures = (cells, attr) => '<dl class="ops-figures"' + (attr ? " " + attr : "") + ">" + cells.map((c) => '<div data-figure="' + esc(c.key) + '"' + (c.recorded ? "" : ' data-recorded="no"') + "><dt>" + esc(c.label) +
    "</dt><dd>" + (c.recorded ? esc(c.text) : '<span class="ops-gap">not recorded yet</span>') + "</dd></div>").join("") + "</dl>";
  function onboardingFarm(f) {
    return '<li class="ops-job" data-onboarding-farm><div class="ops-job-head"><b>' + esc(f.name) + "</b></div>" + figures(f.cells) +
      '<p class="ops-line">' + esc([f.last ? "Latest report saved " + f.last : null, f.started ? "started " + f.started : null,
        f.versions ? f.versions + (f.versions === 1 ? " saved version" : " saved versions") + " with effort" : "no effort record"].filter(Boolean).join(" · ")) + "</p></li>";
  }
  function onboardingGroup(g) {
    const r = g.reconciliation;
    return '<section class="ops-group" data-onboarding-group="' + esc(g.name) + '"><h3>' + esc(g.name) + " · " + g.memberFarms + (g.memberFarms === 1 ? " member farm" : " member farms") + "</h3>" +
      figures(g.cells, 'data-scope="group"') +
      (r ? '<h4>Member reconciliation</h4>' + (r.hasLoad ? figures(r.cells, 'data-scope="reconciliation"') :
        '<p class="ops-line"><span class="ops-gap">not recorded yet</span> — no group load has been recorded for this group, so there is nothing to reconcile.</p>') : "") +
      (g.farms.length ? '<details class="answer-all"><summary>Farms with a report in this group (' + g.farms.length + ')</summary><ul class="ops-list">' + g.farms.map(onboardingFarm).join("") + "</ul></details>" : "") + "</section>";
  }
  function onboardingPanel(v, period) {
    const p = period || M.ratchetPeriod(onboardingKey);
    const picker = '<p class="ops-line"><label>Period <select id="ops-onboarding-period">' + p.options.map((o) =>
      '<option value="' + esc(o.key) + '"' + (o.key === p.key ? " selected" : "") + ">" + esc(o.label) + "</option>").join("") + "</select></label></p>";
    if (!v) return '<section class="answer-panel answer-compact ops-panel" data-ops="onboarding"><h2>Onboarding effort</h2>' + picker + '<p class="answer-sentence" role="alert">Couldn\'t read the onboarding effort.</p></section>';
    const loose = v.farms.filter((f) => !f.groups.length);
    return '<section class="answer-panel answer-compact ops-panel" data-ops="onboarding" data-answer-state="recorded"><h2>' + esc(v.title) + '</h2><p class="answer-sentence">' +
      esc(v.answer.text + " — " + v.answer.because) + "</p>" + picker +
      '<section class="ops-group" data-onboarding-group="all"><h3>All farms</h3>' + figures(v.total.cells, 'data-scope="all"') + "</section>" +
      v.groups.map(onboardingGroup).join("") +
      (loose.length ? '<details class="answer-all"><summary>Farms in no group (' + loose.length + ')</summary><ul class="ops-list">' + loose.map(onboardingFarm).join("") + "</ul></details>" : "") +
      '<details class="ops-steps" data-onboarding-gaps><summary>What is not recorded, and what would record it (' + v.gaps.length + ')</summary><ul class="ops-list">' +
      v.gaps.map((g) => '<li class="ops-line" data-gap-for="' + esc(g.what) + '"><b>' + esc(g.what) + ":</b> " + esc(dot(g.why)) + " Would record it: " + esc(dot(g.would)) + "</li>").join("") + "</ul></details>" +
      '<p class="ops-line">A farm\'s latest report in the period speaks for it; a group or the total adds its farms. Nothing is estimated.</p></section>';
  }
  async function readOnboarding() {
    const p = M.ratchetPeriod(onboardingKey);
    let raw = null;
    try { raw = await read(sb.rpc("onboarding_effort_rollup", { p_from: p.from, p_to: p.to })); } catch { raw = null; }
    return onboardingPanel(M.onboarding(raw, p), p);
  }
  async function changeOnboardingPeriod(select) {
    onboardingKey = select.value;
    const panel = $('[data-ops="onboarding"]'), current = token;
    if (!panel) return;
    const html = await readOnboarding();
    if (current !== token || !panel.isConnected) return;
    panel.outerHTML = html;
    $("#ops-onboarding-period")?.focus();
  }

  let wired = false;
  function wire(box) {
    if (wired || !box?.addEventListener) return;
    wired = true;
    box.addEventListener("click", (e) => { const b = e.target?.closest?.(".ops-recipe-act"); if (b) decide(b); });
    box.addEventListener("change", (e) => { if (e.target?.id === "ops-ratchet-period") changePeriod(e.target); else if (e.target?.id === "ops-onboarding-period") changeOnboardingPeriod(e.target); });
  }

  async function version() {
    try {
      if (FP.demo?.active) return (await FP.demo.ready).build?.version || null;
      const r = await fetch("version.json", { cache: "no-store" });
      return r.ok ? (await r.json()).version : null;
    } catch { return null; }
  }
  async function read(query) { const { data, error } = await query; if (error) throw error; return data; }

  async function open() {
    const current = ++token, box = $("#ops-panels");
    document.body.classList.remove("farm-space-active", "farm-detail", "portfolio-active");
    FP.show("screen-ops");
    document.title = "Operations | " + FP.brand?.product;
    $("#ops-back").setAttribute("href", FP.href(""));
    $("#ops-title").textContent = "Operations";
    const tab = $("#ops-tab"); tab.textContent = "Layers"; tab.setAttribute("href", FP.href("#/ops/layers"));
    box.innerHTML = '<p class="ops-wait">Reading the job records…</p>';
    wire(box);
    try {
      const [jobRows, refRows, v, recipeRows, gapRows, ratchetHtml, onboardingHtml] = await Promise.all([
        read(sb.from("ops_job_status").select("*").order("job_key")),
        read(sb.from("ops_reference_status").select("*").order("name")), version(),
        // The recipes, group-gaps, AI-evaluation and onboarding-effort panels fail on their own: the rest of the page still shows.
        read(sb.from("ai_recipes").select(RECIPE_COLUMNS).order("key")).catch(() => null),
        Promise.resolve().then(() => read(sb.rpc("group_load_gaps", { group_id: null }))).catch(() => null),
        readRatchet(), readOnboarding()]);
      if (current !== token) return;
      box.innerHTML = jobsPanel(M.jobs(jobRows)) + referencesPanel(M.references(refRows)) + gapsPanel(gapRows ? M.loadGaps(gapRows) : null) +
        recipesPanel(recipeRows ? M.recipes(recipeRows, staff) : null) + ratchetHtml + onboardingHtml + buildPanel(M.build(v), M.drawnLine(FP.farmSpace?.lastDrawn?.()), M.drawnLine(FP.groupSpace?.lastDrawn?.(), "Group"),
          { farm: M.stepsLine(FP.farmSpace?.lastDrawn?.()), group: M.stepsLine(FP.groupSpace?.lastDrawn?.(), "Group") });
    } catch (e) {
      if (current === token) box.innerHTML = '<p class="msg" role="alert">Couldn\'t read the job records: ' + esc(e.message || e) + "</p>";
    }
  }
  function close() { token++; }

  FP.ops = { checkStaff, showLinks, isStaff: () => staff, user: () => me, open, close, decide, groupGaps, render: { jobsPanel, referencesPanel, gapsPanel, recipesPanel, ratchetPanel, onboardingPanel, buildPanel } };
})();
