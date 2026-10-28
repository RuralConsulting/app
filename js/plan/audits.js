// Audits and certification for a plan (R3; docs/RECORDS-REG15-16.md). Shows what the certifier or auditor told us,
// beside our own action status; never works anything out for them. Reads and inserts only: a correction is a new row.
(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const api = factory(node ? require("./provenance.js") : root.FP.plan.provenance);
  if (node) module.exports = api; else Object.assign(root.FP.plan, { audits: api });
})(typeof window === "undefined" ? globalThis : window, function (P) {
  const { esc, date } = P;
  const KIND = { certification: "Certification", audit: "Audit" };
  const OUTCOME = { on_time: "On time", late: "Late", not_done: "Not done" };
  const byNewest = (a, b) => String(b.event_date).localeCompare(String(a.event_date)) || String(b.entered_at || "").localeCompare(String(a.entered_at || ""));
  // Current records are those no other record replaces. Everything replaced is an earlier version.
  function split(rows) {
    const replaced = new Set(rows.map((r) => r.supersedes_id).filter(Boolean));
    return { current: rows.filter((r) => !replaced.has(r.id)).sort(byNewest), earlier: rows.filter((r) => replaced.has(r.id)).sort(byNewest) };
  }
  const conflictText = (r) => r.conflict_declaration === "conflict_declared" ? "Conflict declared: " + (r.conflict_note || "") : "No conflict declared";

  const entered = (r) => {
    const p = r.entered_by_person, name = p?.by_name;
    return name && name !== p.user_id ? name : "Name not shown";
  };
  // Compare only explicit contradictions. Missing dates/status are unknown, never a finding.
  function differs(x, a) {
    if (!a) return false;
    if (x.outcome === "not_done") return a.status === "done";
    if (["on_time", "late"].includes(x.outcome) && ["planned", "in_progress", "not_doing"].includes(a.status)) return true;
    if (a.status !== "done" || !a.completed_on || !a.due_date) return false;
    return x.outcome === "on_time" ? a.completed_on > a.due_date : x.outcome === "late" && a.completed_on <= a.due_date;
  }
  function record(r, m, actionable) {
    const results = m.results.filter((x) => x.assessment_id === r.id);
    const doc = r.report_document_id && m.documents.find((d) => d.id === r.report_document_id);
    const reportCell = !r.report_document_id ? "No report attached"
      : doc?.storage_path ? '<button type="button" class="document-link" data-document-path="' + esc(doc.storage_path) + '" data-page="' + esc(r.source_page ?? "") + '">' + esc(doc.title || "Report") + "</button>"
      : esc(doc?.title || "Report attached");
    const row = (label, html) => "<div><dt>" + esc(label) + "</dt><dd>" + html + "</dd></div>";
    const assessor = [r.assessor_name, r.assessor_org].filter(Boolean).map(esc).join(", ");
    const grade = r.grade ? esc(r.grade) + (r.grade_scheme ? " (" + esc(r.grade_scheme) + ")" : "") : "Not recorded";
    const lines = results.map((x) => {
      const a = m.actions.find((y) => y.id === x.action_id);
      const ours = a ? m.statusLabel(a.status) + (a.completed_on ? ", " + date(a.completed_on) : a.due_date ? ", due " + date(a.due_date) : "") : "";
      return "<li><b>" + esc(a ? a.map_code : "Action") + "</b> " + esc(a ? a.title : "No longer in the plan") + (differs(x, a) ? ' <span class="audit-differs">Differs</span>' : "") +
        "<br>Auditor: " + esc(OUTCOME[x.outcome] || x.outcome) + (x.reason ? " — " + esc(x.reason) : "") +
        (a ? '<br><span class="audit-ours">Our record: ' + esc(ours) + "</span>" : "") + "</li>";
    });
    return '<article class="audit-record" data-assessment="' + esc(r.id) + '"><h3>' + esc(KIND[r.kind] || r.kind) + " · " + esc(date(r.event_date)) + "</h3><dl>" +
      row("Entered by", esc(entered(r))) + row("Assessor", assessor) + row("Assessor ID number", r.assessor_id_number ? esc(r.assessor_id_number) : "Not recorded") +
      (r.kind === "audit" ? row("Grade", grade) : "") + row("Conflict", esc(conflictText(r))) +
      row("Next audit due", r.next_audit_due ? esc(date(r.next_audit_due)) : "Not recorded") +
      row("Recertification due", r.recertification_due ? esc(date(r.recertification_due)) : "Not recorded") + row("Report", reportCell) + "</dl>" +
      (r.kind === "audit" ? (lines.length ? '<h4>Actions</h4><ul class="audit-results">' + lines.join("") + "</ul>" : "<p>No action results recorded.</p>") : "") +
      (actionable ? '<button type="button" class="screen-only" data-audit-correct="' + esc(r.id) + '">Correct this record</button>' : "") + "</article>";
  }
  // m: { assessments, results, actions, documents, advisor, statusLabel, error }
  function render(m) {
    m = { assessments: [], results: [], actions: [], documents: [], statusLabel: String, ...m };
    const { current, earlier } = split(m.assessments);
    let body;
    if (m.error) body = "<p>Audits and certification could not be loaded. " + esc(m.error) + "</p>";
    else if (!current.length) body = "<p>No certification or audit recorded yet.</p>" + (m.advisor ? '<button type="button" data-audit-new>Record one</button>' : "");
    else body = (m.advisor ? '<button type="button" data-audit-new>Record a certification or audit</button>' : "") +
      (m.canPack ? ' <button type="button" class="screen-only" data-audit-pack>Audit pack</button>' : "") + current.map((r) => record(r, m, m.advisor)).join("") +
      (earlier.length ? '<details class="audit-earlier"><summary>Earlier versions (' + earlier.length + ")</summary>" + earlier.map((r) => record(r, m, false)).join("") + "</details>" : "");
    return '<section class="plan-section screen-only" id="plan-audits" aria-label="Audits and certification"><h2>Audits and certification</h2>' + body + "</section>";
  }

  // Audit pack (R5): what plan_audit_pack returns, in plain words. Nothing is worked out; a blank is shown as not recorded.
  const NONE = "Not recorded";
  const packDoc = (d) => "<li>" + esc(d.title || "Document") + '<br><span class="pack-hash">SHA-256 ' + esc(d.sha256 || NONE) + "</span></li>";
  const packResult = (x) => "<li>" + esc(x.action_title || "Action") + (x.outcome === "on_time" ? "" : " (" + esc((OUTCOME[x.outcome] || x.outcome).toLowerCase()) + ")") + (x.reason ? " — " + esc(x.reason) : "") + "</li>";
  function packRecord(a) {
    const i = a.items || {}, audit = a.kind === "audit", docs = a.documents || [];
    const row = (label, html) => "<div><dt>" + esc(label) + "</dt><dd>" + html + "</dd></div>";
    const txt = (v) => v ? esc(v) : NONE;
    const when = (v) => v ? esc(date(v)) : NONE;
    const list = (rows, none) => rows && rows.length ? '<ul class="pack-list">' + rows.map(packResult).join("") + "</ul>" : none;
    const who = [i["15b_assessor_name"]?.name, i["15b_assessor_name"]?.org].filter(Boolean).map(esc).join(", ") || NONE;
    const c = i["15d_conflict_declaration"] || {};
    const conflict = c.declaration === "conflict_declared" ? "Conflict declared: " + esc(c.note || "") : c.declaration === "no_conflict" ? "No conflict declared" : NONE;
    const g = i["16c_grade"] || {};
    const na = "Not asked of a certification";
    return '<article class="audit-record pack-record"><h3>' + esc(KIND[a.kind] || a.kind) + " · " + when(i["15a_date"]) + "</h3><dl>" +
      row("Entered by", esc(entered(a))) + row("Date", when(i["15a_date"])) + row("Who did it", who) + row("Assessor ID number", txt(i["15c_assessor_id_number"])) +
      row("Conflict of interest", conflict + (c.document ? "<br>Declaration document: " + esc(c.document.title || "attached") : "")) +
      row("Next audit to be arranged by", when(i["15e_next_audit_due"])) + row("Plan to be resubmitted for recertification by", when(i["15f_recertification_due"])) +
      row("Actions done within their time frames", audit ? list(i["16a_actions_on_time"], "None reported") : na) +
      row("Actions not done within their time frames, and why", audit ? list(i["16b_actions_not_on_time"], "None reported") : na) +
      row("Audit grade", audit ? (g.grade ? esc(g.grade) + (g.scheme ? " (" + esc(g.scheme) + ")" : "") : NONE) : na) + "</dl>" +
      "<h4>Documents</h4>" + (docs.length ? '<ul class="pack-list">' + docs.map(packDoc).join("") + "</ul>" : "<p>No documents attached.</p>") + "</article>";
  }
  // r: { pack } or { message }; ctx: { farm }
  function renderPack(r, ctx = {}) {
    const bar = '<div class="pack-actions screen-only">' + (r.pack ? '<button type="button" data-pack-print>Print / save as PDF</button> <button type="button" data-pack-json>Download data</button> ' : "") + '<button type="button" data-pack-close>Close</button></div>';
    if (!r.pack) return "<h2>Audit pack</h2><p>" + esc(r.message) + "</p>" + bar;
    const k = r.pack, list = k.assessments || [];
    return "<h2>Audit pack</h2>" + '<p class="pack-head">' + esc(ctx.farm || "Farm") + " · " + esc(k.title || "Plan") + " · generated " + esc(date(ctx.today || new Date().toISOString().slice(0, 10))) + "</p>" + bar +
      (list.length ? list.map(packRecord).join("") : "<p>No certification or audit recorded yet.</p>");
  }
  // The database returns null for anyone who is not the farm's advisor or owner.
  async function loadPack(sb, plan) {
    try {
      const r = await sb.rpc("plan_audit_pack", { p: plan });
      if (r.error) return { message: "The audit pack could not be produced. " + (r.error.message || "") };
      if (!r.data) return { message: "Only the farm's advisor or owner can produce the audit pack." };
      return { pack: r.data };
    } catch (e) { return { message: "The audit pack could not be produced. " + (e.message || "") }; }
  }

  // Mirrors the database checks, so a mistake is caught before the save.
  // input: { kind, event_date, assessor_name, conflict_declaration, conflict_note, results: [{ action_id, outcome, reason }] }
  function validate(i) {
    const e = [], blank = (s) => !String(s ?? "").trim();
    if (!KIND[i.kind]) e.push("Choose certification or audit.");
    if (!i.event_date) e.push("Enter the date.");
    if (blank(i.assessor_name)) e.push("Enter the assessor's name.");
    if (!["no_conflict", "conflict_declared"].includes(i.conflict_declaration)) e.push("Say whether a conflict was declared.");
    else if (i.conflict_declaration === "conflict_declared" && blank(i.conflict_note)) e.push("Add the note about the conflict that was declared.");
    if (i.kind === "audit") for (const r of i.results || []) {
      if (!OUTCOME[r.outcome]) e.push("Choose on time, late or not done for each action you report.");
      else if (r.outcome !== "on_time" && blank(r.reason)) e.push("Give the auditor's reason for each late or not-done action.");
    }
    return [...new Set(e)];
  }
  const text = (s) => String(s ?? "").trim() || null;
  function rows(farm, plan, i, supersedes) {
    const record = { farm_id: farm, plan_id: plan, kind: i.kind, event_date: i.event_date, assessor_name: i.assessor_name.trim(), assessor_org: text(i.assessor_org),
      assessor_id_number: text(i.assessor_id_number), conflict_declaration: i.conflict_declaration,
      conflict_note: i.conflict_declaration === "conflict_declared" ? i.conflict_note.trim() : null, report_document_id: i.report_document_id || null,
      grade: i.kind === "audit" ? text(i.grade) : null, grade_scheme: i.kind === "audit" ? text(i.grade_scheme) : null,
      next_audit_due: i.next_audit_due || null, recertification_due: i.recertification_due || null, supersedes_id: supersedes || null };
    const results = i.kind === "audit" ? (i.results || []).map((r) => ({ farm_id: farm, action_id: r.action_id, outcome: r.outcome, reason: r.outcome === "on_time" ? null : r.reason.trim() })) : [];
    return { record, results };
  }
  async function load(sb, farm, plan) {
    const a = await sb.from("plan_assessments").select("*").eq("farm_id", farm).eq("plan_id", plan).order("event_date", { ascending: false });
    if (a.error) throw a.error;
    const r = await sb.from("assessment_action_results").select("*").eq("farm_id", farm);
    if (r.error) throw r.error;
    const ids = new Set(a.data.map((x) => x.id));
    return { assessments: a.data, results: r.data.filter((x) => ids.has(x.assessment_id)) };
  }
  async function save(sb, farm, plan, input, supersedes) {
    const problems = validate(input);
    if (problems.length) throw new Error(problems.join(" "));
    const { record, results } = rows(farm, plan, input, supersedes);
    const made = await sb.from("plan_assessments").insert(record).select("id").single();
    if (made.error) throw new Error("Not saved. " + made.error.message);
    if (results.length) {
      const done = await sb.from("assessment_action_results").insert(results.map((x) => ({ ...x, assessment_id: made.data.id })));
      if (done.error) throw new Error("The record was saved, but the action results were not: " + done.error.message + " Correct the record to add them.");
    }
    return made.data.id;
  }
  return { KIND, OUTCOME, split, render, renderPack, loadPack, validate, rows, load, save };
});
