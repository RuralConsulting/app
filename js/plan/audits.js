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
      return "<li><b>" + esc(a ? a.map_code : "Action") + "</b> " + esc(a ? a.title : "No longer in the plan") +
        "<br>Auditor: " + esc(OUTCOME[x.outcome] || x.outcome) + (x.reason ? " — " + esc(x.reason) : "") +
        (a ? '<br><span class="audit-ours">Our record: ' + esc(ours) + "</span>" : "") + "</li>";
    });
    return '<article class="audit-record" data-assessment="' + esc(r.id) + '"><h3>' + esc(KIND[r.kind] || r.kind) + " · " + esc(date(r.event_date)) + "</h3><dl>" +
      row("Assessor", assessor) + row("Assessor ID number", r.assessor_id_number ? esc(r.assessor_id_number) : "Not recorded") +
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
    else body = (m.advisor ? '<button type="button" data-audit-new>Record a certification or audit</button>' : "") + current.map((r) => record(r, m, m.advisor)).join("") +
      (earlier.length ? '<details class="audit-earlier"><summary>Earlier versions (' + earlier.length + ")</summary>" + earlier.map((r) => record(r, m, false)).join("") + "</details>" : "");
    return '<section class="plan-section screen-only" id="plan-audits" aria-label="Audits and certification"><h2>Audits and certification</h2>' + body + "</section>";
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
  return { KIND, OUTCOME, split, render, validate, rows, load, save };
});
