// Plan routes and prose writes. Render reads use only plan_document; editor/list reads are separate.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FP.plan.routes = api;
})(typeof window === "undefined" ? globalThis : window, function () {
  const uuid = "[0-9a-f-]{36}";
  function match(hash) {
    const m = hash.match(new RegExp("^#/farm/(" + uuid + ")/(plans|plan/(" + uuid + "))$"));
    return m ? { farm: m[1], plan: m[3] || null } : null;
  }
  async function load(sb, farm, plan) {
    const { data, error } = await sb.rpc("plan_document", { p: plan });
    if (error) throw error;
    if (!data || data.farm?.id !== farm || data.plan?.farm_id !== farm) throw new Error("This plan isn't available for this farm.");
    return data;
  }
  async function saveSection(sb, pdm, key, input) {
    if (!["draft", "in_review"].includes(pdm.plan.status)) throw new Error("Start a new version to change signed text.");
    if (pdm.plan.status === "in_review" && !pdm.viewer?.is_advisor) throw new Error("Text is locked during review.");
    if (input.state === "not_applicable" && (!pdm.viewer?.is_advisor || !input.na_reason?.trim())) throw new Error("An advisor must record a reason for Not applicable.");
    if (input.state === "written" && !input.body?.trim()) throw new Error("Write some text before saving it as written.");
    const old = pdm.sections[key] || {};
    // The database stamps the actual writer and author_kind, and keeps the AI draft provenance.
    const row = { plan_id: pdm.plan.id, farm_id: pdm.farm.id, section_key: key,
      body: input.body || "", state: input.state, na_reason: input.state === "not_applicable" ? input.na_reason.trim() : null,
      source_document_id: input.source_document_id || null, source_page: input.source_page || null };
    let query;
    if (old.id) query = sb.from("plan_sections").update(row).eq("id", old.id).eq("plan_id", pdm.plan.id).eq("farm_id", pdm.farm.id).eq("updated_at", old.updated_at);
    else query = sb.from("plan_sections").insert(row);
    const { data, error } = await query.select("id").single();
    if (error) throw new Error("Text was not saved. It may have changed in another window. Reload and try again. " + error.message);
    if (input.citation?.document_id && !old.sources?.some((s) => s.document_id === input.citation.document_id && (s.page ?? null) === (input.citation.page ?? null))) {
      const result = await sb.from("plan_section_sources").insert({ section_id: data.id, farm_id: pdm.farm.id, ...input.citation });
      if (result.error) throw new Error("Text saved, but the extra citation was not saved: " + result.error.message);
    }
    return data;
  }
  async function startPlan(sb, farm, user, input, previous, template, advisor) {
    const { data, error } = await sb.from("plans").insert({
      farm_id: farm, kind: "fep", title: input.title || "Farm Environment Plan", status: "draft", template: template.key,
      template_version: template.version, created_by: user, written_by: advisor ? "advisor" : "farmer",
      prepared_by_name: input.prepared_by_name, prepared_by_role: input.prepared_by_role || null, prepared_by_org: input.prepared_by_org || null,
      plan_date: input.plan_date, version_label: input.version_label, supersedes_plan_id: previous?.id || null,
      for_authorisation_id: input.for_authorisation_id || null,
    }).select("id").single();
    if (error) throw error;
    // Never change the signed version. Carry forward its frozen prose and citations, all as drafts.
    if (previous) {
      try {
        const prior = await load(sb, farm, previous.id);
        for (const [key, s] of Object.entries(prior.sections || {}).filter(([, s]) => s.id)) {
          const result = await sb.from("plan_sections").insert({ farm_id: farm, plan_id: data.id, section_key: key,
            body: s.body, state: "draft", source_document_id: s.source?.document_id || null, source_page: s.source?.page || null,
            ai_model: s.ai_model, ai_model_version: s.ai_model_version, na_reason: s.na_reason || null }).select("id").single();
          if (result.error) throw result.error;
          if (s.sources?.length) {
            const cites = await sb.from("plan_section_sources").insert(s.sources.map((c) => ({ farm_id: farm, section_id: result.data.id,
              document_id: c.document_id, page: c.page, note: c.note })));
            if (cites.error) throw cites.error;
          }
        }
      } catch (e) { throw new Error("Draft created (" + data.id + "), but copying text stopped: " + e.message + ". Open that draft before starting another."); }
    }
    return data.id;
  }
  let navigation = 0;
  function cancel() { navigation++; }
  async function open(route, farm) {
    const token = ++navigation, { $, el, sb } = FP, P = FP.plan.provenance;
    FP.show("screen-plans");
    const host = $("#plan-content"), note = $("#plan-msg"), signal = pageSignal();
    host.replaceChildren(); note.textContent = "Loading…";
    $("#plan-farm-link").href = FP.href("#/farm/" + farm.id);
    $("#plan-list-link").href = FP.href("#/farm/" + farm.id + "/plans");
    $("#plan-farm-label").textContent = farm.name;
    try {
      const user = await FP.auth.user(); if (!user || token !== navigation) return;
      const member = await sb.from("farm_members").select("role").eq("farm_id", farm.id).eq("user_id", user.id).single();
      if (member.error) throw member.error;
      const canEdit = ["owner", "admin", "edit"].includes(member.data.role);
      const org = await sb.from("org_members").select("role").eq("org_id", farm.org_id).eq("user_id", user.id).maybeSingle();
      if (org.error) throw org.error;
      const advisor = canEdit && ["admin", "advisor", "facilitator"].includes(org.data?.role);
      if (!route.plan) {
        const { data: plans, error } = await sb.from("plans").select("id,title,status,plan_date,version_label,created_at").eq("farm_id", farm.id).eq("template", FP.plan.template.key).order("created_at", { ascending: false });
        if (error) throw error; if (token !== navigation) return;
        host.append(el("h1", {}, farm.name + " — plans"), el("ul", { class: "plan-list" }, ...plans.map((p) => el("li", {},
          el("a", { href: FP.href("#/farm/" + farm.id + "/plan/" + p.id) }, p.title + " · " + (p.version_label || "version not recorded") + " · " + p.status.replaceAll("_", " ") + " · " + P.date(p.plan_date))))));
        if (!plans.length) host.append(el("p", {}, "No plans recorded yet."));
        if (canEdit) host.append(el("button", { type: "button", onclick: () => startForm(host, farm, user, plans, token, advisor) }, "Start a new plan version"));
        note.textContent = ""; return;
      }
      const pdm = await load(sb, farm.id, route.plan); if (token !== navigation) return;
      // A frozen PDM records its reviewer's role. Display affordances use this caller's role.
      pdm.viewer = { is_advisor: advisor };
      const rendered = FP.plan.renderReader(pdm);
      host.innerHTML = rendered.html;
      mountReader(host, signal);
      if (FP.demo?.active) for (const a of host.querySelectorAll('a[href^="#/farm/"]')) a.setAttribute("href", FP.href(a.getAttribute("href")));
      await mountAudits(host, pdm, advisor, token, signal, member.data.role === "owner");
      document.title = farm.name + " — Farm Environment Plan";
      if (canEdit && ["draft", "in_review"].includes(pdm.plan.status) && (pdm.plan.status === "draft" || advisor)) {
        const keys = [...new Set([...Object.keys(pdm.sections), "land_unit_definitions", "action_method", "action_categories", "management_introduction", "risk_method"])];
        const pick = el("select", { "aria-label": "Plan text to edit" }, ...keys.map((key) => el("option", { value: key }, FP.plan.template.labels.section(key))));
        host.querySelector(".plan-contents").append(el("div", { class: "prose-picker screen-only" }, pick, el("button", { type: "button", onclick: () => editor(host, pdm, pick.value, token) }, "Edit plan text")));
      }
      for (const button of host.querySelectorAll("[data-edit-section]")) {
        if (!canEdit || (pdm.plan.status === "in_review" && !pdm.viewer?.is_advisor)) button.remove();
        else button.addEventListener("click", () => editor(host, pdm, button.dataset.editSection, token));
      }
      host.addEventListener("click", (event) => {
        const anchor = event.target.closest("[data-plan-anchor]");
        if (anchor) { event.preventDefault(); selectSection(host, anchor.dataset.planAnchor); }
        const doc = event.target.closest("[data-document-path]");
        if (doc) signedDocument(doc, doc.dataset.documentPath, doc.dataset.page);
      }, { signal });
      // Photos use signed URLs only; no reads of the live evidence/facts tables.
      for (const img of host.querySelectorAll("[data-photo-path]")) {
        const { data, error } = await sb.storage.from("documents").createSignedUrl(img.dataset.photoPath, 3600);
        if (token !== navigation) return;
        if (!error) img.src = data.signedUrl; else img.alt = "Photo unavailable";
      }
      note.textContent = "";
    } catch (e) { if (token === navigation) note.textContent = e.message || String(e); }
  }
  function selectSection(host, id, scroll = true) {
    const target = host.querySelector('[id="' + CSS.escape(id) + '"]');
    if (!target?.classList.contains("plan-section")) return;
    for (const section of host.querySelectorAll(".plan-section")) section.classList.toggle("is-active", section === target);
    for (const link of host.querySelectorAll(".plan-contents [data-plan-anchor]")) {
      if (link.dataset.planAnchor === id) link.setAttribute("aria-current", "location"); else link.removeAttribute("aria-current");
    }
    const contents = host.querySelector(".plan-contents");
    contents?.classList.remove("contents-open");
    contents?.querySelector("[data-contents-toggle]")?.setAttribute("aria-expanded", "false");
    if (scroll) {
      target.scrollIntoView({ behavior: "instant", block: "start" });
      target.setAttribute("tabindex", "-1"); target.focus({ preventScroll: true });
    }
  }
  function mountReader(host, signal) {
    const contents = host.querySelector(".plan-contents");
    const toggle = FP.el("button", { type: "button", "data-contents-toggle": "", "aria-expanded": "false", "aria-controls": "reader-contents" }, "Contents");
    contents.querySelector(".contents-links").id = "reader-contents";
    contents.prepend(toggle);
    selectSection(host, "plan-front", false);
    const toolbar = document.querySelector(".plan-toolbar");
    const observer = new ResizeObserver(() => {
      host.style.setProperty("--plan-toolbar-height", toolbar.getBoundingClientRect().height + "px");
      host.style.setProperty("--reader-nav-height", contents.getBoundingClientRect().height + "px");
    });
    observer.observe(toolbar); observer.observe(contents);
    signal.addEventListener("abort", () => observer.disconnect(), { once: true });
    host.addEventListener("click", (event) => {
      if (event.target.closest("[data-contents-toggle]")) {
        const expanded = contents.classList.toggle("contents-open"); toggle.setAttribute("aria-expanded", String(expanded));
      }
      const trigger = event.target.closest("[data-source-open]");
      if (trigger) {
        const modal = FP.el("dialog", { class: "source-dialog", "aria-label": "Value source" });
        modal.append(FP.el("h2", {}, "Source"), trigger.closest("[data-provenance]").querySelector("template").content.cloneNode(true), FP.el("button", { type: "button", onclick: () => modal.close() }, "Close"));
        modal.addEventListener("close", () => { modal.remove(); trigger.focus(); }); host.append(modal); modal.showModal();
      }
    }, { signal });
  }
  // Audits and certification: read for every member, recorded by advisors only. It sits beside the plan, not inside it.
  async function mountAudits(host, pdm, advisor, token, signal, owner = false) {
    const A = FP.plan.audits, L = FP.plan.template.labels;
    const actions = (pdm.actions?.programme || []).filter((a) => !["possible", "not_doing"].includes(a.status));
    const documents = pdm.documents || [];
    let data = { assessments: [], results: [] }, error = null;
    try { data = await A.load(FP.sb, pdm.farm.id, pdm.plan.id); } catch (e) { error = e.message || String(e); }
    if (token !== navigation) return;
    const paint = () => {
      const html = A.render({ ...data, actions, documents, advisor, canPack: advisor || owner, error, statusLabel: (s) => L.enumLabel("action_status", s) });
      const old = host.querySelector("#plan-audits");
      if (old) { const next = document.createElement("template"); next.innerHTML = html; const fresh = next.content.firstElementChild;
        fresh.classList.toggle("is-active", old.classList.contains("is-active")); old.replaceWith(fresh); }
      else {
        host.querySelector(".reader-body").insertAdjacentHTML("beforeend", html);
        host.querySelector(".contents-links").insertAdjacentHTML("beforeend", '<a href="#plan-audits" data-plan-anchor="plan-audits">Audits and certification</a>');
      }
    };
    paint();
    host.addEventListener("click", (event) => {
      if (event.target.closest("[data-audit-new]")) auditForm(host, pdm, actions, documents, data, null, token, async () => { data = await A.load(FP.sb, pdm.farm.id, pdm.plan.id); paint(); });
      if (event.target.closest("[data-audit-pack]")) auditPack(host, pdm);
      const fix = event.target.closest("[data-audit-correct]");
      if (fix) auditForm(host, pdm, actions, documents, data, data.assessments.find((r) => r.id === fix.dataset.auditCorrect), token, async () => { data = await A.load(FP.sb, pdm.farm.id, pdm.plan.id); paint(); });
    }, { signal });
  }
  // Audit pack: a printable page in a dialog, built from plan_audit_pack. Print uses the browser's own print, as Print plan does.
  async function auditPack(host, pdm) {
    const d = FP.el("dialog", { class: "prose-dialog audit-pack-dialog", "aria-label": "Audit pack" });
    d.innerHTML = "<p>Preparing the audit pack…</p>"; host.append(d); d.showModal();
    d.addEventListener("close", () => { document.body.classList.remove("pack-printing"); d.remove(); });
    const r = await FP.plan.audits.loadPack(FP.sb, pdm.plan.id);
    d.innerHTML = FP.plan.audits.renderPack(r, { farm: pdm.farm.name });
    d.querySelector("[data-pack-close]").addEventListener("click", () => d.close());
    d.querySelector("[data-pack-print]")?.addEventListener("click", () => { document.body.classList.add("pack-printing"); window.print(); document.body.classList.remove("pack-printing"); });
    d.querySelector("[data-pack-json]")?.addEventListener("click", () => {
      const a = FP.el("a", { href: URL.createObjectURL(new Blob([JSON.stringify(r.pack, null, 2)], { type: "application/json" })), download: "audit-pack-" + pdm.plan.id + ".json" });
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
  }
  function auditForm(host, pdm, actions, documents, data, previous, token, done) {
    const A = FP.plan.audits, { el } = FP;
    const { d, form, note, finish } = dialog(host, previous ? "Correct this " + A.KIND[previous.kind].toLowerCase() : "Record a certification or audit");
    const kind = el("select", { name: "kind" }, el("option", { value: "certification" }, "Certification"), el("option", { value: "audit" }, "Audit"));
    form.append(el("label", {}, "What was recorded", kind));
    if (previous) { kind.value = previous.kind; kind.disabled = true; }
    const val = (k) => previous?.[k] || "";
    const eventDate = field(form, "Date", "date", "event_date", val("event_date"), true);
    const name = field(form, "Assessor's name", "text", "assessor_name", val("assessor_name"), true);
    const org = field(form, "Assessor's organisation", "text", "assessor_org", val("assessor_org"));
    const idNumber = field(form, "Assessor's ID number", "text", "assessor_id_number", val("assessor_id_number"));
    const conflict = el("select", { name: "conflict_declaration" }, el("option", { value: "no_conflict" }, "No conflict declared"), el("option", { value: "conflict_declared" }, "A conflict is declared"));
    conflict.value = previous?.conflict_declaration || "no_conflict";
    form.append(el("label", {}, "Conflict", conflict));
    const conflictNote = field(form, "Note on the conflict", "textarea", "conflict_note", val("conflict_note"));
    const nextAudit = field(form, "Next audit due", "date", "next_audit_due", val("next_audit_due"));
    const recert = field(form, "Plan recertification due", "date", "recertification_due", val("recertification_due"));
    const report = el("select", { name: "report" }, el("option", { value: "" }, "No report attached"), ...documents.map((x) => el("option", { value: x.id }, x.title)));
    report.value = val("report_document_id"); form.append(el("label", {}, "Report", report));
    const auditOnly = el("div", { class: "audit-only" });
    const grade = field(auditOnly, "Grade", "text", "grade", val("grade")), scheme = field(auditOnly, "Grading scheme (optional)", "text", "grade_scheme", val("grade_scheme"));
    const carry = previous?.kind === "audit" && data.results.some((r) => r.assessment_id === previous.id);
    const copy = el("input", { type: "checkbox", name: "copy_results" }); copy.checked = carry;
    if (carry) auditOnly.append(el("label", { class: "inline" }, copy, "Start from the earlier results"));
    const fieldset = el("fieldset", {}, el("legend", {}, "The auditor's finding for each action (leave blank if not reported)"));
    const lines = actions.map((a) => {
      const outcome = el("select", { "aria-label": a.map_code + " " + a.title }, el("option", { value: "" }, "Not reported"), ...Object.entries(A.OUTCOME).map(([v, t]) => el("option", { value: v }, t)));
      const reason = el("input", { type: "text", placeholder: "Auditor's reason", "aria-label": "Reason for " + a.map_code });
      fieldset.append(el("div", { class: "audit-line" }, el("span", {}, a.map_code + " " + a.title), outcome, reason));
      return { a, outcome, reason };
    });
    const fill = () => { for (const l of lines) {
      const r = copy.checked && data.results.find((x) => x.assessment_id === previous?.id && x.action_id === l.a.id);
      l.outcome.value = r?.outcome || ""; l.reason.value = r?.reason || ""; } };
    fill(); copy.addEventListener("change", fill);
    auditOnly.append(actions.length ? fieldset : el("p", {}, "This plan has no actions to report on."));
    form.append(auditOnly);
    const sync = () => { auditOnly.hidden = kind.value !== "audit"; conflictNote.closest("label").hidden = conflict.value !== "conflict_declared"; };
    kind.addEventListener("change", sync); conflict.addEventListener("change", sync); sync();
    if (previous) form.append(el("p", {}, "Saving adds a corrected record. The earlier one stays under Earlier versions."));
    form.noValidate = true;
    finish();
    form.addEventListener("submit", async (event) => {
      event.preventDefault(); const button = form.querySelector("[type=submit]");
      const input = { kind: kind.value, event_date: eventDate.value, assessor_name: name.value, assessor_org: org.value, assessor_id_number: idNumber.value,
        conflict_declaration: conflict.value, conflict_note: conflictNote.value, next_audit_due: nextAudit.value, recertification_due: recert.value,
        report_document_id: report.value, grade: grade.value, grade_scheme: scheme.value,
        results: lines.filter((l) => l.outcome.value).map((l) => ({ action_id: l.a.id, outcome: l.outcome.value, reason: l.reason.value })) };
      const problems = A.validate(input);
      if (problems.length) { note.textContent = problems.join(" "); return; }
      button.disabled = true; note.textContent = "Saving…";
      try { await A.save(FP.sb, pdm.farm.id, pdm.plan.id, input, previous?.id); d.close(); if (token === navigation) await done(); }
      catch (e) { note.textContent = e.message; button.disabled = false; if (/was saved/.test(e.message)) done(); }
    });
    form.querySelector("[type=submit]").disabled = false;
  }
  let pageController;
  function pageSignal() { pageController?.abort(); pageController = new AbortController(); return pageController.signal; }
  async function signedDocument(button, path, page) {
    // Open synchronously to retain the user's click gesture, then supply the short-lived URL.
    const win = window.open("about:blank", "_blank"); if (win) win.opener = null;
    const { data, error } = await FP.sb.storage.from("documents").createSignedUrl(path, 3600);
    if (error) { win?.close(); button.textContent = "Document unavailable — try again"; return; }
    if (win) win.location.href = data.signedUrl + (page ? "#page=" + page : "");
  }
  function field(form, label, kind, name, val = "", required = false) {
    const input = FP.el(kind === "textarea" ? "textarea" : "input", { name, ...(kind !== "textarea" ? { type: kind } : {}), required });
    input.value = val || ""; const wrapper = FP.el("label", {}, label, input); form.append(wrapper); return input;
  }
  function dialog(host, title) {
    const d = FP.el("dialog", { class: "prose-dialog" }), form = FP.el("form", {}), note = FP.el("p", { role: "status" });
    form.append(FP.el("h2", {}, title)); d.append(form); host.append(d);
    // Never allow native form submission to put plan text into a navigation URL.
    form.addEventListener("submit", (event) => event.preventDefault());
    d.addEventListener("close", () => d.remove());
    const finish = () => { form.append(note, FP.el("button", { type: "submit", disabled: true }, "Save"), FP.el("button", { type: "button", onclick: () => d.close() }, "Cancel")); d.showModal(); };
    return { d, form, note, finish };
  }
  async function editor(host, pdm, key, token) {
    const s = pdm.sections[key] || {}, { d, form, note, finish } = dialog(host, "Edit " + FP.plan.template.labels.section(key));
    const body = field(form, "Plan text (markdown; use live values such as {{fact:effective_area}})", "textarea", "body", s.body);
    const state = FP.el("select", { name: "state" }, ...[["draft", "Draft"], ["written", "Written"], ...(pdm.viewer.is_advisor ? [["not_applicable", "Not applicable"]] : [])].map(([v, text]) => FP.el("option", { value: v }, text)));
    state.value = s.state === "not_recorded" || !s.state ? "draft" : s.state;
    form.append(FP.el("label", {}, "Text state", state));
    const reason = field(form, "Reason if Not applicable (advisor)", "text", "reason", s.na_reason);
    const sourceSelect = FP.el("select", { name: "source" }, FP.el("option", { value: "" }, "No imported text source"));
    const citeSelect = FP.el("select", { name: "citation" }, FP.el("option", { value: "" }, "No extra citation"));
    form.append(FP.el("label", {}, "Imported text source", sourceSelect));
    const page = field(form, "Source page", "number", "page", s.source?.page); page.min = 1; page.step = 1;
    form.append(FP.el("p", {}, "Existing citations are retained."), FP.el("label", {}, "Add a citation", citeSelect));
    const citePage = field(form, "Citation page (optional)", "number", "cite_page"); citePage.min = 1; citePage.step = 1;
    const citeNote = field(form, "Citation note (optional)", "text", "cite_note");
    finish();
    // Editor-only document picker. It never feeds the pure renderer.
    const result = await FP.sb.from("documents").select("id,title").eq("farm_id", pdm.farm.id).order("title");
    if (token !== navigation) { d.close(); return; }
    if (result.error) { note.textContent = result.error.message; form.querySelector("[type=submit]").disabled = true; return; }
    for (const doc of result.data) { sourceSelect.append(FP.el("option", { value: doc.id }, doc.title)); citeSelect.append(FP.el("option", { value: doc.id }, doc.title)); }
    sourceSelect.value = s.source?.document_id || "";
    form.addEventListener("submit", async (event) => {
      event.preventDefault(); const button = form.querySelector("[type=submit]"); button.disabled = true; note.textContent = "Saving…";
      try {
        await saveSection(FP.sb, pdm, key, { body: body.value, state: state.value, na_reason: reason.value,
          source_document_id: sourceSelect.value, source_page: page.value ? Number(page.value) : null,
          citation: citeSelect.value ? { document_id: citeSelect.value, page: citePage.value ? Number(citePage.value) : null, note: citeNote.value || null } : null });
        d.close();
        if (token === navigation) {
          if (FP.demo?.active) open({ farm: pdm.farm.id, plan: pdm.plan.id }, pdm.farm);
          else location.reload();
        }
      } catch (e) { note.textContent = e.message; button.disabled = false; }
    });
    form.querySelector("[type=submit]").disabled = false;
  }
  async function startForm(host, farm, user, plans, token, advisor) {
    const { d, form, note, finish } = dialog(host, "Start a new Farm Environment Plan");
    const name = field(form, "Plan developer", "text", "prepared_by_name", "", true);
    const role = field(form, "Developer's role", "text", "prepared_by_role");
    const org = field(form, "Developer's organisation", "text", "prepared_by_org");
    const dateInput = field(form, "Plan date", "date", "plan_date", "", true);
    const version = field(form, "Version label", "text", "version_label", "", true);
    const forAuth = FP.el("select", {}, FP.el("option", { value: "" }, "Not for a specific authorisation"));
    form.append(FP.el("label", {}, "Prepared for", forAuth));
    const previous = plans.find((p) => p.status === "signed_off");
    form.append(FP.el("p", {}, previous ? "This starts a draft from the latest signed plan. Its text and citations will be carried forward as drafts." : "This starts a draft. Farm records supply the plan's values."));
    finish();
    const auths = await FP.sb.from("authorisations").select("id,title,consent_no,rule_ref").eq("farm_id", farm.id).order("title");
    if (token !== navigation) { d.close(); return; }
    if (auths.error) { note.textContent = auths.error.message; form.querySelector("[type=submit]").disabled = true; return; }
    for (const a of auths.data) forAuth.append(FP.el("option", { value: a.id }, [a.consent_no || a.rule_ref, a.title].filter(Boolean).join(" — ")));
    form.addEventListener("submit", async (event) => {
      event.preventDefault(); const button = form.querySelector("[type=submit]"); button.disabled = true; note.textContent = "Starting draft…";
      try {
        // Read the caller-scoped PDM for the previous plan; no profile-policy widening for the UI.
        const id = await startPlan(FP.sb, farm.id, user.id, { prepared_by_name: name.value, prepared_by_role: role.value, prepared_by_org: org.value,
          plan_date: dateInput.value, version_label: version.value, for_authorisation_id: forAuth.value }, previous, FP.plan.template, advisor);
        d.close(); if (token === navigation) location.hash = FP.href("#/farm/" + farm.id + "/plan/" + id);
      } catch (e) { note.textContent = e.message; button.disabled = false; }
    });
    form.querySelector("[type=submit]").disabled = false;
  }
  return { match, load, saveSection, startPlan, open, cancel, openDocument: signedDocument,
    startNew: (host, farm, user, plans, advisor) => startForm(host, farm, user, plans, ++navigation, advisor) };
});


