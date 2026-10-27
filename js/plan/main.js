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
    const host = $("#plan-content"), note = $("#plan-msg");
    host.replaceChildren(); note.textContent = "Loading…";
    $("#plan-farm-link").href = "#/farm/" + farm.id;
    $("#plan-list-link").href = "#/farm/" + farm.id + "/plans";
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
          el("a", { href: "#/farm/" + farm.id + "/plan/" + p.id }, p.title + " · " + (p.version_label || "version not recorded") + " · " + p.status.replaceAll("_", " ") + " · " + P.date(p.plan_date))))));
        if (!plans.length) host.append(el("p", {}, "No plans recorded yet."));
        if (canEdit) host.append(el("button", { type: "button", onclick: () => startForm(host, farm, user, plans, token, advisor) }, "Start a new plan version"));
        note.textContent = ""; return;
      }
      const pdm = await load(sb, farm.id, route.plan); if (token !== navigation) return;
      // A frozen PDM records its reviewer's role. Display affordances use this caller's role.
      pdm.viewer = { is_advisor: advisor };
      host.innerHTML = FP.plan.renderPlan(pdm);
      document.title = farm.name + " — Farm Environment Plan";
      if (canEdit && ["draft", "in_review"].includes(pdm.plan.status) && (pdm.plan.status === "draft" || advisor)) {
        const keys = [...new Set([...Object.keys(pdm.sections), "land_unit_definitions", "action_method", "action_categories", "management_introduction", "risk_method"])];
        const pick = el("select", { "aria-label": "Plan text to edit" }, ...keys.map((key) => el("option", { value: key }, key.replaceAll("_", " ").replaceAll(".", " / "))));
        host.prepend(el("div", { class: "prose-picker screen-only" }, pick, el("button", { type: "button", onclick: () => editor(host, pdm, pick.value, token) }, "Edit plan text")));
      }
      for (const button of host.querySelectorAll("[data-edit-section]")) {
        if (!canEdit || (pdm.plan.status === "in_review" && !pdm.viewer?.is_advisor)) button.remove();
        else button.addEventListener("click", () => editor(host, pdm, button.dataset.editSection, token));
      }
      host.addEventListener("click", (event) => {
        const anchor = event.target.closest("[data-plan-anchor]");
        if (anchor) { event.preventDefault(); document.getElementById(anchor.dataset.planAnchor)?.scrollIntoView({ behavior: "smooth" }); }
        const doc = event.target.closest("[data-document-path]");
        if (doc) signedDocument(doc, doc.dataset.documentPath, doc.dataset.page);
      }, { signal: pageSignal() });
      // Photos use signed URLs only; no reads of the live evidence/facts tables.
      for (const img of host.querySelectorAll("[data-photo-path]")) {
        const { data, error } = await sb.storage.from("documents").createSignedUrl(img.dataset.photoPath, 3600);
        if (token !== navigation) return;
        if (!error) img.src = data.signedUrl; else img.alt = "Photo unavailable";
      }
      note.textContent = "";
    } catch (e) { if (token === navigation) note.textContent = e.message || String(e); }
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
    const s = pdm.sections[key] || {}, { d, form, note, finish } = dialog(host, "Edit " + key.replaceAll("_", " "));
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
        d.close(); if (token === navigation) location.reload();
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
        d.close(); if (token === navigation) location.hash = "#/farm/" + farm.id + "/plan/" + id;
      } catch (e) { note.textContent = e.message; button.disabled = false; }
    });
    form.querySelector("[type=submit]").disabled = false;
  }
  return { match, load, saveSection, startPlan, open, cancel };
});
