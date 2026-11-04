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

  return { REPO, links, day, time, jobs, references, build, recipes, needsAttention, runUrl, loadGaps };
});
