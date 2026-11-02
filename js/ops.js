// The Operations page (#/ops), for RCL staff only: the data jobs, the reference sources, the AI's how-to recipes and the
// build, on one screen. The one thing it changes is a recipe's status (Approve / Retire, a platform advisor's, confirmed
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
    for (const a of $$(".ops-link")) { a.hidden = !staff; for (const n of $$("a", a)) n.setAttribute("href", FP.href("#/ops")); }
    const header = $("#space-ops");
    if (header) header.setAttribute("href", FP.href("#/ops"));
    return staff;
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
  function buildPanel(b) {
    return '<section class="answer-panel answer-compact ops-panel" data-ops="build"><h2>Build</h2><p class="answer-sentence">' + esc(b.answer.text) + " — " + esc(b.answer.because) + "</p>" +
      '<ul class="ops-linklist">' + b.links.map(([label, href]) => "<li>" + ext(href, label) + "</li>").join("") +
      (b.commitUrl ? "<li>" + ext(b.commitUrl, "This version's commit") + "</li>" : "") + "</ul></section>";
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
  let wired = false;
  function wire(box) {
    if (wired || !box?.addEventListener) return;
    wired = true;
    box.addEventListener("click", (e) => { const b = e.target?.closest?.(".ops-recipe-act"); if (b) decide(b); });
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
      const [jobRows, refRows, v, recipeRows] = await Promise.all([
        read(sb.from("ops_job_status").select("*").order("job_key")),
        read(sb.from("ops_reference_status").select("*").order("name")), version(),
        // The recipes panel fails on its own: the rest of the page still shows.
        read(sb.from("ai_recipes").select(RECIPE_COLUMNS).order("key")).catch(() => null)]);
      if (current !== token) return;
      box.innerHTML = jobsPanel(M.jobs(jobRows)) + referencesPanel(M.references(refRows)) + recipesPanel(recipeRows ? M.recipes(recipeRows, staff) : null) + buildPanel(M.build(v));
    } catch (e) {
      if (current === token) box.innerHTML = '<p class="msg" role="alert">Couldn\'t read the job records: ' + esc(e.message || e) + "</p>";
    }
  }
  function close() { token++; }

  FP.ops = { checkStaff, isStaff: () => staff, user: () => me, open, close, decide, render: { jobsPanel, referencesPanel, recipesPanel, buildPanel } };
})();
