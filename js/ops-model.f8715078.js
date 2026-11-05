// Operations page model (A4a): what the data-job and reference-source records say, in plain words. No DOM, network or clock:
// rows come from the ops_job_status and ops_reference_status views, which have already worked out each job's health.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api; else root.FP.opsModel = api;
})(typeof window === "undefined" ? globalThis : window, function () {
  const REPO = "https://github.com/RuralConsulting/farm-platform";
  const links = {
    pulls: REPO + "/pulls", actions: REPO + "/actions", queue: REPO + "/blob/main/docs/QUEUE.md",
    issues: REPO + "/issues?q=" + encodeURIComponent("is:issue is:open label:data-ops"),
    workflow: (file) => /^[a-z0-9-]+\.yml$/.test(file || "") ? REPO + "/actions/workflows/" + file : null,
    commit: (sha) => /^[0-9a-f]{7,40}$/.test(sha || "") ? REPO + "/commit/" + sha : null,
  };
  // Only GitHub run pages are ever linked from a record.
  const runUrl = (u) => typeof u === "string" && /^https:\/\/github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/actions\/runs\/\d+(\/attempts\/\d+)?$/.test(u) ? u : null;

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const parts = (ts) => {
    const t = Date.parse(ts);
    if (!Number.isFinite(t)) return null;
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-NZ", { timeZone: "Pacific/Auckland", year: "numeric", month: "numeric", day: "numeric",
      hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, min: +p.minute };
  };
  // "29 Oct 2026" and "29 Oct 2026, 3:12 pm", in New Zealand time.
  const day = (ts) => { const p = parts(ts); return p ? p.d + " " + MONTHS[p.m - 1] + " " + p.y : null; };
  const time = (ts) => {
    const p = parts(ts);
    return p ? day(ts) + ", " + (p.h % 12 || 12) + ":" + String(p.min).padStart(2, "0") + " " + (p.h < 12 ? "am" : "pm") : null;
  };
  const num = (n) => Number(n).toLocaleString("en-NZ");
  const count = (n, one, many) => (n === 1 ? "One " + one : n + " " + many);
  const cnt = (n, one, many) => (n === 1 ? "one " + one : n + " " + many);

  const healthWord = { ok: "OK", late: "Late", failing: "Failing", never_run: "Never run" };
  const runWord = { success: "succeeded", partial: "finished with some failures", failed: "failed", skipped: "was skipped" };
  const groups = [["refresh-reference", "Reference refresh"], ["collect", "Collectors"], ["derive-waterways", "Derived layers"],
    ["deploy-db", "Database"], ["ops-watchdog", "Watchdog"]];
  const label = (k) => String(k).replaceAll("_", " ");

  const needsAttention = (j) => !!j.enabled && (j.health === "failing" || j.health === "late" || (j.health === "never_run" && !!j.overdue));

  // Why a job is promoted, stated by the record itself.
  function reason(j) {
    if (j.health === "failing") return "failed " + (time(j.last_run_finished_at) || "recently") + (j.last_error_category ? ": " + j.last_error_category : "");
    if (j.health === "late") return "no success since " + (day(j.last_success_at) || "it was set up") + ", expected by " + (day(j.next_expected_at) || "now");
    return "has not run yet, expected by " + (day(j.next_expected_at) || "now");
  }

  function job(j) {
    const attention = needsAttention(j), counts = Object.entries(j.last_run_summary || {}).filter(([, v]) => Number.isFinite(Number(v))).slice(0, 8);
    const next = !j.enabled ? "Run by hand" : j.cadence_hours == null ? "Runs when a migration is merged" : j.next_expected_at ? "Next expected by " + day(j.next_expected_at) : null;
    return {
      key: j.job_key, title: j.title || j.job_key, group: groups.find(([k]) => k === j.kind)?.[0] || "other", health: j.enabled ? j.health : "off",
      badge: j.enabled ? healthWord[j.health] || j.health : "Off", attention, because: attention ? reason(j) : null,
      success: j.last_success_at ? "Last success " + time(j.last_success_at) : "No success yet", next,
      last: j.last_run_status ? "Last run " + (runWord[j.last_run_status] || j.last_run_status) + " " + (time(j.last_run_finished_at) || "") : "Not run yet",
      category: j.last_run_status === "failed" ? j.last_error_category || null : null,
      counts: counts.map(([k, v]) => label(k) + " " + num(v)),
      runUrl: runUrl(j.last_run_url), workflowUrl: links.workflow(j.workflow), commit: j.last_commit_sha ? j.last_commit_sha.slice(0, 7) : null,
      commitUrl: links.commit(j.last_commit_sha), note: attention ? j.owner_note || null : null,
    };
  }

  function jobs(rows) {
    const list = (Array.isArray(rows) ? rows : []).map(job);
    const severity = { failing: 0, late: 1, never_run: 2 };
    const attention = list.filter((j) => j.attention).sort((a, b) => severity[a.health] - severity[b.health] || a.key.localeCompare(b.key));
    const enabled = (Array.isArray(rows) ? rows : []).filter((r) => r.enabled);
    const oldest = enabled.filter((r) => r.last_success_at).sort((a, b) => Date.parse(a.last_success_at) - Date.parse(b.last_success_at))[0];
    const answer = !list.length ? null : attention.length
      ? { text: count(attention.length, "data job needs attention", "data jobs need attention"), because: attention[0].title + " " + attention[0].because }
      : { text: "Every data job is on time", because: oldest ? "the longest since a success is " + (oldest.title || oldest.job_key) + ", " + day(oldest.last_success_at) : "nothing has run yet" };
    return { title: "Data jobs", answer, empty: "No data jobs are recorded yet.", attention, items: list,
      groups: [...groups, ["other", "Other"]].map(([key, name]) => ({ key, name, items: list.filter((j) => j.group === key) })).filter((g) => g.items.length) };
  }

  const licenceWord = { open: "Open licence", restricted: "Restricted", pending_check: "Licence to check" };
  function references(rows) {
    const list = (Array.isArray(rows) ? rows : []).map((r) => ({
      key: r.source_key, title: r.name || r.source_key, rights: !!r.rights_changed,
      licence: licenceWord[r.licence_status] || label(r.licence_status || "unknown"), served: r.serve_to_customers ? "Shown to customers" : "Held back",
      refreshed: r.refreshed_at ? "Refreshed " + day(r.refreshed_at) : "Not refreshed yet", features: r.feature_count != null ? num(r.feature_count) + " features" : null,
      flag: r.rights_changed ? "The provider's copyright wording changed at the last pull: check the licence" : null,
      lastPull: r.last_pull_status === "failed" ? "The last pull failed" + (r.last_pull_note ? ": " + r.last_pull_note : "") : null,
    }));
    const flagged = list.filter((r) => r.rights), held = list.filter((r) => r.served === "Held back").length;
    const answer = !list.length ? null : flagged.length
      ? { text: count(flagged.length, "source has new licence wording", "sources have new licence wording"), because: flagged[0].title + ": the provider's copyright text changed at its last pull" }
      : { text: "Licence wording is unchanged on all " + list.length + " sources", because: (list.length - held) + " shown to customers, " + held + " held back" };
    return { title: "Reference sources", answer, empty: "No reference sources are recorded yet.", attention: flagged, items: list };
  }

  // The deployed version is "<yyyymmddhhmm>-<commit>" from the publish workflow, or just the time for a local build.
  function build(version) {
    const v = typeof version === "string" ? version : "";
    const m = v.match(/^(\d{12})(?:-([0-9a-f]{7}))?$/);
    return { version: m ? m[1] : null, commit: m?.[2] || null, commitUrl: m?.[2] ? links.commit(m[2]) : null,
      answer: m ? { text: "The app on this page is version " + m[1] + (m[2] ? ", commit " + m[2] : ""), because: "published to app.ruralconsulting.co.nz" }
        : { text: "The app's version isn't available", because: "it is read from the published files" },
      links: [["Pull requests", links.pulls], ["Actions", links.actions], ["Data job issues", links.issues], ["The queue", links.queue]] };
  }
  // PERF1b: how long this browser took to draw the last farm it opened, from the page's start (the `farm-drawn` measure,
  // farm-space.js; kept for the tab). Null when there is no figure. Seconds to one place; the farm is not named.
  function drawnLine(v) {
    const ms = v && v.ms != null ? Number(v.ms) : NaN;
    if (!Number.isFinite(ms) || ms < 0) return null;
    return "Farm drawn in " + (ms / 1000).toFixed(1) + " s on this browser's last open, from the page's start";
  }

  // AI recipes (AI1): how-to recipes the AI keeps, one row per version (ai_recipes). Drafts wait for a platform advisor; the
  // AI reads approved ones only. `canDecide`: the viewer is a platform advisor, so Approve and Retire are offered (row-level
  // security is the real gate); anyone else reads the list only.
  const recipeWord = { draft: "Draft", approved: "Approved", retired: "Retired" };
  const authorWord = (r) => r.author_kind === "ai" ? "Proposed by the AI" + (r.author_model ? " (" + r.author_model + ")" : "")
    : r.author_kind === "system" ? "Seeded from what the platform's collectors know" : "Proposed by an advisor";
  const methodWord = { get: "GET", post: "POST", page: "Page" };
  function recipeVersion(r, canDecide) {
    const steps = (Array.isArray(r.steps) ? r.steps : []).filter((s) => s && typeof s === "object" && typeof s.source === "string");
    const status = recipeWord[r.status] ? r.status : "draft";
    return {
      id: r.id, key: r.key, version: Number.isInteger(r.version) ? r.version : null, status, badge: recipeWord[status], title: r.title || r.key,
      when: r.when_to_use || null, tags: (Array.isArray(r.tags) ? r.tags : []).filter((t) => typeof t === "string"),
      author: authorWord(r) + (day(r.created_at) ? ", " + day(r.created_at) : ""),
      decided: status === "approved" && day(r.approved_at) ? "Approved " + day(r.approved_at)
        : status === "retired" ? "Retired" + (day(r.retired_at) ? " " + day(r.retired_at) : "") + (r.retire_reason ? ": " + r.retire_reason : "") : null,
      unverified: /not yet verified/i.test([r.title, r.when_to_use].join(" ")),
      steps: steps.map((s, i) => (i + 1) + ". " + s.source + (s.endpoint ? " · " + (methodWord[s.method] || "GET") + " " + s.endpoint : "")),
      actions: !canDecide ? [] : status === "draft" ? ["approve", "retire"] : status === "approved" ? ["retire"] : [],
    };
  }
  function recipes(rows, canDecide) {
    const byKey = new Map();
    for (const r of Array.isArray(rows) ? rows : []) {
      if (!r || typeof r.key !== "string") continue;
      if (!byKey.has(r.key)) byKey.set(r.key, []);
      byKey.get(r.key).push(r);
    }
    const items = [...byKey.entries()].map(([key, rs]) => {
      const versions = rs.sort((a, b) => (b.version || 0) - (a.version || 0)).map((r) => recipeVersion(r, !!canDecide));
      const approved = versions.find((v) => v.status === "approved") || null, drafts = versions.filter((v) => v.status === "draft");
      return { key, title: (drafts[0] || approved || versions[0]).title, versions, approved: approved ? approved.version : null, drafts: drafts.length };
    }).sort((a, b) => (b.drafts > 0) - (a.drafts > 0) || a.key.localeCompare(b.key));
    const waiting = items.filter((i) => i.drafts), approved = items.filter((i) => i.approved !== null).length;
    const answer = !items.length ? null : waiting.length
      ? { text: count(waiting.reduce((n, i) => n + i.drafts, 0), "recipe waits for review", "recipes wait for review"),
        because: waiting[0].title + "; the AI uses only approved recipes (" + (approved ? approved + " approved" : "none yet") + ")" }
      : { text: approved ? "Every recipe is reviewed" : "No recipe is approved", because: approved + " approved; the AI uses only these" };
    return { title: "AI recipes", answer, empty: "No how-to recipes are recorded yet.", items, canDecide: !!canDecide };
  }

  // Group data completeness (DQ1): what a group load set aside rather than guess, from public.group_load_gaps(). One entry
  // per group the viewer may see; `detail` false (a group member who is not an admin) means counts only, no list.
  const GAP_KINDS = ["fep_unmatched", "fep_not_in_register", "paddock_held", "member_no_extent"];
  const gapWords = {
    fep_unmatched: { one: "FEP file not linked to a member", many: "FEP files not linked to a member", tail: "set aside, not guessed",
      resolve: "Put the member number in the file name the way the group's load reads it, then re-run the group load." },
    fep_not_in_register: { one: "FEP file names a member number that is not in the register", many: "FEP files name a member number that is not in the register", tail: "set aside, not guessed",
      resolve: "Add the member to the register (the members layer or a FarmData folder), or correct the number in the file name; then re-run the group load." },
    paddock_held: { one: "paddock held back from the map", many: "paddocks held back from the map", tail: "no member id or a placeholder id, not guessed",
      resolve: "Give each paddock its member's id in the paddock layer, then re-run the group load." },
    member_no_extent: { one: "member with no map extent", many: "members with no map extent", tail: "on the register, but no block to show",
      resolve: "Add the member's block to the members layer, then re-run the group load." },
  };
  const kindWord = { fep_unmatched: "FEP file not linked", fep_not_in_register: "FEP file, number not in the register", paddock_held: "Paddocks held back", member_no_extent: "No map extent" };
  const gapCount = (kind, n) => (n === 1 ? "one " : num(n) + " ") + (n === 1 ? gapWords[kind].one : gapWords[kind].many);
  const gapLine = (kind, n) => { const c = gapCount(kind, n); return { kind, items: n, text: c[0].toUpperCase() + c.slice(1) + " — " + gapWords[kind].tail, resolve: gapWords[kind].resolve }; };
  // One row of the list: a member on the register (its number and name as the group's register holds them), an id the
  // source gave that is not a member, or no id at all. Never a member the load did not name itself.
  function gapItem(i) {
    const n = Number(i.items) || 0, id = typeof i.external_id === "string" ? i.external_id : null;
    const who = i.business_name ? "Member " + i.member_number + ", " + i.business_name : id ? "Id " + id + ", not a member on the register" : "No member id";
    return { kind: i.kind, who, byMember: !!(i.business_name || id), what: kindWord[i.kind], reason: i.reason || "", items: n,
      count: i.kind === "paddock_held" ? num(n) + (n === 1 ? " paddock" : " paddocks") : i.kind.startsWith("fep_") ? num(n) + (n === 1 ? " file" : " files") : null,
      files: i.kind === "paddock_held" || i.kind === "member_no_extent" ? [] : (Array.isArray(i.files) ? i.files : []).filter((f) => typeof f === "string"),
      source: i.kind === "paddock_held" || i.kind === "member_no_extent" ? (Array.isArray(i.files) && typeof i.files[0] === "string" ? i.files[0] : null) : null,
      resolve: gapWords[i.kind].resolve };
  }
  function loadGaps(rows) {
    const groups = (Array.isArray(rows) ? rows : []).filter((g) => g && typeof g === "object").map((g) => {
      const counts = g.counts && typeof g.counts === "object" ? g.counts : {};
      const lines = GAP_KINDS.filter((k) => Number(counts[k]) > 0).map((k) => gapLine(k, Number(counts[k])));
      const items = g.detail && Array.isArray(g.items) ? g.items.filter((i) => i && gapWords[i.kind]).map(gapItem) : [];
      return { id: g.group_id, name: g.group_name || "Group", detail: !!g.detail, checked: day(g.checked_at), lines, total: lines.reduce((n, l) => n + l.items, 0),
        members: items.filter((i) => i.byMember), unlinked: items.filter((i) => !i.byMember) };
    });
    const open = groups.filter((g) => g.total), first = open[0];
    const answer = !groups.length ? null : open.length
      ? { text: (open.length === 1 ? first.name + ": " + num(first.total) + (first.total === 1 ? " item" : " items") : open.length + " groups have items") + " set aside by the last group load",
        because: first.lines.map((l) => gapCount(l.kind, l.items)).join(", ") + (first.checked ? "; load of " + first.checked : "") }
      : { text: "Every group load placed everything", because: "nothing is set aside" };
    return { title: "Group data completeness", answer, empty: "No group load is recorded yet.", groups };
  }

  // The ratchet evaluation (EV1): per AI flow, for a period, the proposals made, accepted and dismissed, the corrections per 100
  // accepted and the AI cost, from public.ai_ratchet_evaluation() (counts only; RCL staff only). A figure the records do not hold
  // is a `gap` that says what would record it, never an estimate and never a zero: `null` is "not recorded yet".
  const PERIODS = [["30d", "Last 30 days", 30], ["7d", "Last 7 days", 7], ["90d", "Last 90 days", 90], ["all", "All time", null]];
  const PHRASE = { "30d": "in the last 30 days", "7d": "in the last 7 days", "90d": "in the last 90 days", all: "over all time" };
  function ratchetPeriod(key, nowMs) {
    const p = PERIODS.find(([k]) => k === key) || PERIODS[0], now = Number.isFinite(nowMs) ? nowMs : Date.now();
    return { key: p[0], label: p[1], phrase: PHRASE[p[0]], from: p[2] === null ? null : new Date(now - p[2] * 86400000).toISOString(), to: new Date(now).toISOString(),
      options: PERIODS.map(([k, l]) => ({ key: k, label: l })) };
  }
  const int = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0; };
  const usd = (n) => "US$" + (n === 0 ? "0.00" : n < 0.01 ? n.toFixed(4) : n.toFixed(2));
  const cost = (c, n) => n > 0 ? "US$" + c.toFixed(4) + " known; " + cnt(n, "call has no cost recorded", "calls have no cost recorded") : usd(c);
  const per100 = (n, of) => of > 0 ? Math.round(n / of * 1000) / 10 : null;
  const GAP = {
    dismissed: "A proposal that is dismissed, or left unconfirmed, leaves no record.",
    modelCost: "The model-call rows in ai_calls carry no action name, so one flow's share of the AI's cost is not recorded.",
  };
  const WOULD = {
    dismissed: "A one-line record when a person dismisses the proposal.",
    modelCost: "The action name on the model call's own ai_calls row.",
  };
  function ratchet(raw, period) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const d2 = raw.d2 || {}, x1 = raw.x1 || {}, cc = raw.cc1 || {};
    const files = int(d2.files), asIs = int(d2.as_proposed), fixed = int(d2.after_fix), plain = int(d2.code_mapping), open = int(d2.not_loaded);
    const d2done = asIs + fixed, d2cost = Number(d2.cost_usd) || 0, d2unknown = int(d2.unknown_cost_calls);
    const made = int(x1.actions_run), done = int(x1.accepted), over = int(x1.overrides);
    const consents = int(cc.consents_accepted), conds = int(cc.conditions_accepted), lookups = int(cc.ask_lookups);
    const gap = (what, why, would) => ({ what, why, would });
    const flows = [{
      key: "plan-mapping", name: "Plan mapping", made: null, accepted: null, dismissed: null, corrections: null, per100: null, cost: null,
      detail: ["Nothing is stored yet: the AI fallback builds its proposals but is not connected to the plan import, and the import's confirm report is a file, not a record."],
      gaps: [gap("All figures", "no proposal is recorded", "The confirm report (plan-import-report/1) kept as a plan_import_report document once the AI fallback feeds it: each AI line, and whether it was accepted.")],
    }, {
      key: "consent-conditions", name: "Consent conditions", made: null, accepted: consents, dismissed: null, corrections: null, per100: null,
      cost: "No model is called",
      detail: [count(consents, "consent has its ECan conditions accepted", "consents have their ECan conditions accepted") + " (" + cnt(conds, "condition", "conditions") + ").",
        "Ask fetched conditions " + (lookups === 1 ? "once" : lookups + " times") + "; the What's due button leaves no record."],
      gaps: [gap("Made", "a lookup is not recorded", "A record of each proposal shown (the consent and the time)."),
        gap("Dismissed", GAP.dismissed, WOULD.dismissed),
        gap("Corrections", "Accept records the proposal as shown and later edits are not tied to it", "The accepted conditions compared with the proposal.")],
    }, {
      key: "import-mapping", name: "Spreadsheet import mapping", made: files, accepted: d2done, dismissed: null, corrections: fixed, per100: per100(fixed, d2done),
      cost: cost(d2cost, d2unknown),
      detail: [count(files, "file", "files") + " the AI was asked to map columns of: " + asIs + " loaded as the AI proposed, " + fixed + " after a person fixed the mapping, " +
          plain + " with the code's own mapping, " + open + " not loaded (set aside or still open).",
        count(int(d2.saved_mapping_imports), "import was", "imports were") + " loaded from a saved mapping, with no AI asked."],
      gaps: [gap("Dismissed", GAP.dismissed + " Not loaded may still be open.", WOULD.dismissed)],
    }, {
      key: "analyses", name: "Water-quality analyses", made, accepted: done, dismissed: null, corrections: over, per100: per100(over, done), cost: null,
      detail: [count(made, "analysis was", "analyses were") + " run by the AI; " + cnt(done, "was", "were") + " confirmed from AI-proposed inputs, " +
        int(x1.accepted_with_overrides) + " with at least one input changed (" + cnt(over, "input", "inputs") + ")."],
      gaps: [gap("Dismissed", GAP.dismissed, WOULD.dismissed), gap("AI cost", GAP.modelCost, WOULD.modelCost)],
    }];
    for (const f of flows) {
      const text = (v) => v === null || v === undefined ? null : typeof v === "number" ? num(v) : String(v);
      f.cells = [["made", "Proposals made", text(f.made)], ["accepted", "Accepted", text(f.accepted)], ["dismissed", "Dismissed", text(f.dismissed)],
        ["corrections", "Corrections per 100 accepted", f.corrections === null ? null : f.per100 === null ? "None accepted yet" : f.per100 + " (" + num(f.corrections) + " in " + num(f.accepted) + ")"],
        ["cost", "AI cost", text(f.cost)]].map(([key, label, t]) => ({ key, label, text: t, recorded: t !== null }));
    }
    const withMade = flows.filter((f) => f.made !== null);
    const made_ = withMade.reduce((n, f) => n + f.made, 0), acc = flows.reduce((n, f) => n + (f.accepted || 0), 0);
    const purposes = (Array.isArray(raw.by_purpose) ? raw.by_purpose : []).filter((p) => p && typeof p.purpose === "string").map((p) =>
      ({ purpose: p.purpose, calls: int(p.calls), refused: int(p.refused), cost: Number(p.cost_usd) || 0, unknown: int(p.unknown_cost_calls) }));
    const totalCalls = purposes.reduce((n, p) => n + p.calls, 0), totalCost = purposes.reduce((n, p) => n + p.cost, 0), totalUnknown = purposes.reduce((n, p) => n + p.unknown, 0);
    const when = period?.phrase || "in the period";
    const silent = flows.filter((f) => f.made === null).length;
    return {
      title: "AI evaluation", period: period || ratchetPeriod("30d"), flows,
      answer: { text: made_ || acc ? num(made_) + (made_ === 1 ? " proposal" : " proposals") + " made where it is recorded, " + num(acc) + " accepted, " + when
          : "No proposals are recorded " + when,
        because: silent + (silent === 1 ? " flow records" : " flows record") + " too little to measure; each says what would record it" },
      total: { calls: totalCalls, text: num(totalCalls) + (totalCalls === 1 ? " AI call" : " AI calls") + " " + when + ", " + cost(totalCost, totalUnknown), purposes },
      evaluation: { text: "The held-out-site evaluation (a held-out site's overrides N to 0, and a negative site refused) runs in CI and is recorded only in that run's summary.",
        url: links.workflow("ci.yml") },
    };
  }

  // The onboarding effort (MC3): per farm, per catchment group and overall, for a period, from public.onboarding_effort_rollup()
  // (numbers only; RCL staff only). A farm's latest record in the period speaks for it (its elapsed time and steps are cumulative
  // at each save, so versions are never added together); a group or the total is the sum of its farms. Nothing is estimated: a
  // figure no record holds is "not recorded yet" and says what would record it.
  const mins = (m) => m < 120 ? m + " min" : m < 48 * 60 ? Math.floor(m / 60) + " h" + (m % 60 ? " " + (m % 60) + " min" : "") : num(Math.round(m / 1440)) + " days";
  const of = (a, b) => num(a) + " of " + num(b) + (b === 1 ? " farm" : " farms");
  const list = (v) => Array.isArray(v) ? v.filter((x) => x && typeof x === "object") : [];
  // The five figures for one scope. t: totals (reports_saved, farms, farms_with_*, elapsed_minutes, ...); one: a single farm.
  function effortCells(t, one) {
    const farms = int(t.farms), withEffort = int(t.farms_with_effort), withElapsed = int(t.farms_with_elapsed), withMinutes = int(t.farms_with_minutes);
    const cell = (key, label, text, recorded) => ({ key, label, text, recorded });
    return [
      cell("reports", "Reports saved", num(int(t.reports_saved)) + (int(t.reports_without_record) ? " (" + int(t.reports_without_record) + " before effort was recorded in the database)" : ""), true),
      cell("elapsed", "Elapsed, first step to latest report", mins(int(t.elapsed_minutes)) + (one ? "" : " across " + of(withElapsed, farms)), withElapsed > 0),
      cell("minutes", "Minutes entered by hand", mins(int(t.minutes_by_hand)) + (one ? "" : " entered for " + of(withMinutes, farms)), withMinutes > 0),
      cell("hand", "Steps by hand", num(int(t.hand_steps)) + (one ? "" : " across " + of(withEffort, farms)), withEffort > 0),
      cell("automatic", "Found automatically", num(int(t.automatic)) + (one ? "" : " across " + of(withEffort, farms)), withEffort > 0)];
  }
  function reconciliation(r) {
    if (!r || typeof r !== "object") return null;
    const n = (k) => int(r[k]);
    const cell = (key, label, text) => ({ key, label, text, recorded: true });
    return { hasLoad: r.has_load === true, cells: [
      cell("confirmed", "Matches confirmed", num(n("matches_confirmed")) + (n("matches_confirmed") ? " by " + (n("confirmed_by_people") === 1 ? "one person" : n("confirmed_by_people") + " people") : "")),
      cell("resolved", "Gaps resolved with a confirmed match", num(n("gaps_resolved"))),
      cell("waiting", "Confirmed, item still set aside now", num(n("confirmed_still_set_aside"))),
      cell("stale", "Stale now (the business has retired)", num(n("stale_business_retired"))),
      cell("open", "Set aside with no match now", num(n("open_unmatched")))] };
  }
  function onboarding(raw, period) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const all = raw.all && typeof raw.all === "object" ? raw.all : {};
    const when = period?.phrase || "in the period";
    const farm = (f) => ({ name: String(f.name ?? ""), groups: Array.isArray(f.groups) ? f.groups.map(String) : [], saved: int(f.reports_saved), last: f.last_saved_at ? day(f.last_saved_at) : null,
      cells: effortCells({ farms: 1, reports_saved: f.reports_saved, reports_without_record: f.reports_without_record, farms_with_effort: int(f.records) > 0 ? 1 : 0,
        farms_with_elapsed: f.elapsed_minutes == null ? 0 : 1, elapsed_minutes: f.elapsed_minutes, farms_with_minutes: f.minutes_by_hand == null ? 0 : 1, minutes_by_hand: f.minutes_by_hand,
        hand_steps: f.hand_steps, automatic: f.automatic }, true),
      versions: int(f.records), started: f.started_at ? day(f.started_at) : null });
    const farms = list(raw.farms).map(farm);
    const groups = list(raw.groups).map((g) => ({ name: String(g.name ?? ""), memberFarms: int(g.member_farms), farms: farms.filter((f) => f.groups.includes(String(g.name ?? ""))),
      cells: effortCells(g.totals || {}, false), reconciliation: reconciliation(g.reconciliation), farmsWithReports: int(g.totals?.farms) }));
    const before = int(all.reports_without_record);
    const gap = (what, why, would) => ({ what, why, would });
    const gaps = [
      gap("Monthly updates", "the monthly update (group-update) records no time", "A nullable minutes-by-hand field when a monthly update is saved, kept next to it."),
      gap("Data updates and imports", "a data update or spreadsheet import records no time", "A nullable minutes-by-hand field when an import is confirmed, kept on the import record."),
      gap("Time saved", "no manual baseline is recorded, so no saving can be read off", "RCL's manual minutes for each task, entered once, set against the minutes entered above."),
      gap("Stale because the file changed", "only tools/reconcile_group.py reads the group's files, so the database cannot tell a changed item from one waiting for the next load",
        "The tool writing how many matches it found stale into the group's record each time it runs."),
      ...(before ? [gap("Reports saved before effort was recorded in the database", before + (before === 1 ? " report holds" : " reports hold") + " its effort only inside the saved file, which the database cannot open",
        "Saving the report again; the earlier ones cannot be recovered without opening the files.")] : [])];
    const reports = int(all.reports_saved), n = int(all.farms);
    return {
      title: "Onboarding effort", period: period || ratchetPeriod("30d"), groups, farms, gaps,
      total: { cells: effortCells(all, false), farms: n },
      answer: { text: reports ? num(reports) + (reports === 1 ? " onboarding report" : " onboarding reports") + " saved " + when + " for " + (n === 1 ? "one farm" : n + " farms")
          : "No onboarding report was saved " + when,
        because: int(all.farms_with_effort) ? "effort is recorded for " + of(int(all.farms_with_effort), n) : "no effort is recorded for them in the database yet" },
    };
  }

  return { REPO, links, day, time, jobs, references, build, drawnLine, recipes, needsAttention, runUrl, loadGaps, ratchet, ratchetPeriod, onboarding };
});
