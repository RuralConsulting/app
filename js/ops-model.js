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

  return { REPO, links, day, time, jobs, references, build, needsAttention, runUrl };
});
