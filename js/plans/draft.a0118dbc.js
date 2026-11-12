// FW1: a draft Freshwater Farm Plan on screen (plan-draft/1, made by tools/draft_fwfp.py from the farm's adopted FEP).
// The gap list is the first section: what the FWFP needs that the FEP did not carry. Then the AI-drafted narrative
// fields, each "AI-drafted — not accepted" until an advisor of the farm accepts or edits it (public.accept_plan_draft_value
// records when, and the capacity: "an advisor", "an editor of this farm"; no name leaves the farm). Then the pre-filled
// document itself, by plans/render.js, every AI-drafted node marked, with no issue date (a draft is never issued). A draft
// is never printed as a plan: there is no Print here, and the print stylesheet hides it.
// Signed in: #/plan-draft/<entry id> (Accept and Edit for an advisor; "Draft with AI" for an editor, through the fwfp-draft
// edge function, which works with AI switched off too: the fields stay gaps; a viewer reads only). Demo:
// #/demo/plans?doc=fwfp-draft, fixture data, read only.
(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const api = factory(node ? require("./render.js") : root.FP.farmPlans);
  if (node) module.exports = api; else { root.FP = root.FP || {}; root.FP.farmPlanDraft = api; }
})(typeof window === "undefined" ? globalThis : window, function (R) {
  const root = typeof window === "undefined" ? globalThis : window;
  const AI_FLAG = "AI-drafted — not accepted";
  const KIND = { new_in_fwfp: "New in the FWFP", empty_in_fep: "Not in the FEP", needs_person: "Needs a person", confirm: "Rating to confirm" };
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const keyOf = (v) => v.node + "." + v.field + (v.instance ? "[" + v.instance + "]" : "");
  const anchor = (key) => "plan-" + String(key).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  function fieldLabel(definition, node, field) {
    let found = null;
    const visit = (nodes) => { for (const n of nodes || []) { if (n.key === node) found = n; visit(n.nodes); } };
    for (const p of definition.parts || []) visit(p.nodes);
    const f = (found?.fields || []).find((x) => x.key === field);
    return { node: found?.title || node, field: f?.label || field.replace(/_/g, " ") };
  }
  // The day in New Zealand, as the plan document writes dates.
  const when = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : R.formatDate(d.toLocaleDateString("en-CA", { timeZone: "Pacific/Auckland" })); };
  // Who accepted, as the database recorded it (accepted[key].capacity): the capacity only, never a name (LN2's way).
  const CAPACITY = { advisor: "an advisor", editor: "an editor of this farm" };

  // The AI-drafted values: flagged until accepted; accepted ones say by whom (the capacity) and when.
  function aiValues(draft) {
    return (draft.values || []).filter((v) => v && v.ai).map((v) => ({ value: v, key: keyOf(v), accepted: (draft.accepted || {})[keyOf(v)] || null }));
  }
  function status(item) {
    if (!item.accepted) return AI_FLAG;
    const who = CAPACITY[item.accepted.capacity] || "someone on this farm";
    return (item.accepted.edited ? "Edited and accepted by " : "Accepted by ") + who + (item.accepted.at ? ", " + when(item.accepted.at) : "");
  }

  // ---- the page, as HTML (the same in node tests and the browser) ------------------------------------------------
  function render(definition, draft, brand = null, { canEdit = false, advisor = false, aiOn = true, aiDraftable = true } = {}) {
    if (!draft || draft.schema !== "plan-draft/1") throw new Error("Not a draft");
    const gaps = draft.gaps || [];
    const ai = aiValues(draft);
    const pending = ai.filter((x) => !x.accepted).length;
    const draftable = (draft.ai?.fields || []).filter((k) => !(draft.values || []).some((v) => v.node + "." + v.field === k && !v.instance));
    const title = (draft.to?.title || "Freshwater Farm Plan").split(" (")[0];
    let html = '<div class="plan-draft" data-draft-status="draft">';
    html += '<header class="draft-head"><p class="draft-badge">Draft</p><h1 class="draft-title">' + esc(title) + " — draft for " + esc(draft.farm?.name || "this farm") + "</h1>" +
      '<p class="draft-lede">Made on ' + esc(R.formatDate(draft.made_on)) + " from the farm's Farm Environment Plan (v" + esc(draft.from?.version) + ")" +
      ", matched field by field with no AI: " + esc(String((draft.values || []).filter((v) => !v.ai).length)) + " answers came across. " +
      "It is not the farm's own yet, and it is never issued or printed, until a person accepts it and " + esc(title) + " v" + esc(draft.to?.version) + " is published and adopted.</p></header>";

    // 1. the gaps: first
    html += '<section class="draft-gaps" data-section="gaps" aria-labelledby="draft-gaps-h"><h2 id="draft-gaps-h">What this draft still needs (' + gaps.length + ")</h2>" +
      "<p>Parts the Freshwater Farm Plan asks for that the Farm Environment Plan did not carry, in their order. Each needs a person.</p><ol class=\"draft-gap-list\">";
    for (const g of gaps) {
      const fields = (g.fields || []).map((f) => fieldLabel(definition, g.node, f).field);
      const rows = (g.instances || []).length;
      html += '<li class="draft-gap" data-gap="' + esc(g.node) + '" data-kind="' + esc(g.kind) + '">' +
        '<p class="draft-gap-title"><a href="#' + anchor(g.node) + '" data-goto="' + esc(g.node) + '">' + esc(g.title || g.node) + "</a> " +
        '<span class="draft-kind">' + esc(KIND[g.kind] || g.kind) + "</span>" + (g.required ? "" : ' <span class="draft-optional">optional</span>') + "</p>" +
        '<p class="draft-gap-why">' + esc(g.reason) + (rows ? " (" + rows + (rows === 1 ? " row" : " rows") + ")" : "") + "</p>" +
        (fields.length ? '<p class="draft-gap-fields">To complete: ' + esc(fields.join(", ")) + "</p>" : "") +
        Object.entries(g.hint_from || {}).map(([f, hs]) => '<p class="draft-gap-hint"><span>From the FEP, as a start for ' + esc(fieldLabel(definition, g.node, f).field) + ":</span> " +
          esc(hs.map((h) => (typeof h.value === "string" ? h.value : JSON.stringify(h.value))).join(" · ")) + "</p>").join("") +
        (g.prior_assessment || []).map((p) => '<p class="draft-gap-hint"><span>The FEP author\'s rating' + (p.instance ? " (" + esc(p.instance) + ")" : "") + ":</span> " +
          esc(p.value) + (p.assessed_by ? " — " + esc(p.assessed_by) : "") + (p.assessed_on ? ", " + esc(R.formatDate(p.assessed_on)) : "") + "</p>").join("") +
        ((g.ai || []).length ? '<p class="draft-gap-ai">' + (aiOn ? "AI can draft " : "AI is off: write ") + esc(g.ai.map((f) => fieldLabel(definition, g.node, f).field).join(", ")) + (aiOn ? " from the FEP text above, for you to check." : " yourself.") + "</p>" : "") +
        "</li>";
    }
    html += "</ol></section>";

    // 2. the AI-drafted fields: flagged until accepted
    html += '<section class="draft-ai" data-section="ai" aria-labelledby="draft-ai-h"><h2 id="draft-ai-h">AI-drafted fields' + (pending ? " (" + pending + " not accepted)" : "") + "</h2>";
    if (!ai.length) html += "<p>None yet." + (draftable.length && canEdit && aiOn && aiDraftable ? " Draft with AI writes the narrative fields from the FEP's text, for you to check." : "") + "</p>";
    for (const item of ai) {
      const lab = fieldLabel(definition, item.value.node, item.value.field);
      html += '<article class="draft-ai-item" data-key="' + esc(item.key) + '" data-accepted="' + (item.accepted ? "true" : "false") + '">' +
        "<h3>" + esc(lab.node) + " · " + esc(lab.field) + "</h3>" +
        '<p class="draft-flag" role="status">' + esc(status(item)) + "</p>" +
        '<div class="draft-ai-text">' + esc(item.value.value).replace(/\n/g, "<br>") + "</div>" +
        // Accept and Edit only for an advisor of the farm (the database refuses anyone else); an editor is told who accepts.
        (advisor ? '<p class="draft-ai-actions"><button type="button" data-act="accept">' + (item.accepted ? "Accept again" : "Accept") + '</button> <button type="button" data-act="edit">Edit</button></p>'
          : canEdit && !item.accepted ? '<p class="draft-ai-who">An advisor of the farm accepts this.</p>' : "") +
        "</article>";
    }
    // A farm with no organisation has no advisor to accept what the AI drafts (the database refuses the step there too).
    if (canEdit && !aiDraftable) html += '<p class="draft-ai-run draft-ai-none">Write these fields yourself: AI drafts need an advisor of the farm to accept them.</p>';
    else if (canEdit) html += '<p class="draft-ai-run"><button type="button" data-act="draft-ai"' + (draftable.length ? "" : " disabled") + ">Draft with AI</button> <span>" +
      (draftable.length ? esc(draftable.length + " narrative field" + (draftable.length === 1 ? "" : "s") + " left; only the FEP's text for each is sent.") : "Nothing left to draft.") + "</span></p>";
    html += "</section>";

    // 3. the pre-filled document, AI-drafted nodes marked (no issue date: a draft is never issued)
    const values = R.valuesFromPlanDocument(definition, { values: draft.values || [] }, { farm: draft.farm?.name });
    let doc = R.render(definition, values, brand, {});
    // no issue date on a draft: the cover's "Issued: To complete" row is left out (the renderer is shared with issues)
    doc = doc.replace('<div><dt>Issued</dt><dd>' + R.TO_COMPLETE + '</dd></div>', "").replace('--plan-running-date:"' + R.TO_COMPLETE + '"', '--plan-running-date:""');
    for (const item of ai) doc = markNode(doc, item.value.node, item.accepted ? status(item) : AI_FLAG + ": " + fieldLabel(definition, item.value.node, item.value.field).field, !item.accepted);
    html += '<section class="draft-doc" data-section="document" aria-label="The draft">' + doc + "</section></div>";
    return html;
  }

  // A marker at the top of a node's section in the rendered document (the renderer is shared with issues: it is not
  // changed for drafts, so the mark is added here).
  function markNode(html, node, text, pending) {
    const at = new RegExp('(<section class="plan-(?:node|group)[^"]*" data-node="' + node.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + '"[^>]*>(?:<h[2-6][^>]*>[\\s\\S]*?</h[2-6]>)?)');
    return html.replace(at, '$1<p class="draft-mark" data-pending="' + (pending ? "true" : "false") + '">' + esc(text) + "</p>");
  }

  // ---- the browser page --------------------------------------------------------------------------------------------
  let screen = null, opened = 0;
  const el = (...a) => root.FP.el(...a);
  function ensureScreen() {
    if (screen) return screen;
    screen = el("main", { id: "screen-plan-draft", class: "plans-screen plan-draft-screen", hidden: true },
      el("div", { class: "plans-bar" }, el("a", { href: "#/", class: "draft-back" }, "Back"), el("span", { class: "draft-bar-note" }, "Draft · never issued or printed")),
      el("div", { class: "plans-page", "aria-live": "polite" }));
    document.body.append(screen);
    return screen;
  }
  function wire(host, onGoto) {
    for (const a of host.querySelectorAll("[data-goto]")) a.addEventListener("click", (ev) => {
      const target = host.querySelector('[data-node="' + a.dataset.goto + '"]');
      if (!target) return;
      ev.preventDefault(); target.scrollIntoView({ block: "start" }); onGoto?.(a.dataset.goto);
    });
  }

  // What the signed-in person may do on this farm's draft: an editor (owner, admin or edit on the farm) drafts with AI;
  // an advisor (an editor who is also an admin, advisor or facilitator of the farm's organisation, app.is_advisor) also
  // accepts. A viewer reads. aiDraftable: the farm has an organisation, so there can be an advisor to accept AI drafts. Anything unreadable counts as less, never more: the database decides in the end.
  async function capacity(sb, farmId) {
    try {
      const { data: auth } = await sb.auth.getUser();
      const me = auth?.user?.id;
      if (!me) return { canEdit: false, advisor: false, aiDraftable: false };
      const [{ data: member }, { data: farm }] = await Promise.all([
        sb.from("farm_members").select("role").eq("farm_id", farmId).eq("user_id", me).maybeSingle(),
        sb.from("farms").select("org_id").eq("id", farmId).maybeSingle()]);
      const canEdit = ["owner", "admin", "edit"].includes(member?.role);
      const aiDraftable = !!farm?.org_id;
      if (!canEdit || !aiDraftable) return { canEdit, advisor: false, aiDraftable };
      const { data: org } = await sb.from("org_members").select("role").eq("org_id", farm.org_id).eq("user_id", me).maybeSingle();
      return { canEdit, advisor: ["admin", "advisor", "facilitator"].includes(org?.role), aiDraftable };
    } catch { return { canEdit: false, advisor: false, aiDraftable: false }; }
  }

  // Signed in: the draft entry (read under row-level security), its target version's definition, and who the viewer is.
  async function open(sb, entryId) {
    const mine = ++opened;
    const s = ensureScreen(), host = s.querySelector(".plans-page");
    document.body.classList.add("plans-open");
    root.FP.show("screen-plan-draft");
    host.setAttribute("aria-busy", "true");
    const fail = (m) => { host.replaceChildren(el("p", { class: "plans-error", role: "alert" }, m)); host.removeAttribute("aria-busy"); };
    const { data: row, error } = await sb.from("entries").select("id, farm_id, data").eq("id", entryId).maybeSingle();
    if (mine !== opened) return;
    if (error || !row || row.data?.schema !== "plan-draft/1") return fail("There's no draft here that you can open.");
    const { data: tpl } = await sb.from("templates").select("definition").eq("id", row.data.to?.template_id).maybeSingle();
    if (!tpl) return fail("The version this draft is for isn't available.");
    const { canEdit, advisor, aiDraftable } = await capacity(sb, row.farm_id);
    if (mine !== opened) return;
    const draw = (draft, note) => {
      host.innerHTML = (note ? '<p class="draft-note" role="status">' + esc(note) + "</p>" : "") + render(tpl.definition, draft, null, { canEdit, advisor, aiDraftable });
      wire(host);
      for (const art of host.querySelectorAll(".draft-ai-item")) {
        const key = art.dataset.key;
        art.querySelector('[data-act="accept"]')?.addEventListener("click", () => accept(key, null));
        art.querySelector('[data-act="edit"]')?.addEventListener("click", () => {
          const text = draft.values.find((v) => keyOf(v) === key)?.value || "";
          const box = el("textarea", { class: "draft-edit", rows: "6", "aria-label": "Edit this field" });
          box.value = text;
          const save = el("button", { type: "button", onclick: () => accept(key, box.value) }, "Save and accept");
          art.querySelector(".draft-ai-text").replaceWith(box);
          art.querySelector(".draft-ai-actions").replaceChildren(save);
          box.focus();
        });
      }
      host.querySelector('[data-act="draft-ai"]')?.addEventListener("click", runAi);
      host.removeAttribute("aria-busy");
    };
    async function accept(key, value) {
      host.setAttribute("aria-busy", "true");
      const { data, error: e } = await sb.rpc("accept_plan_draft_value", value == null ? { p_entry: entryId, p_key: key } : { p_entry: entryId, p_key: key, p_value: value });
      if (e) { host.removeAttribute("aria-busy"); return root.alert?.(e.message); }
      draw(data, "Accepted.");
    }
    async function runAi() {
      host.setAttribute("aria-busy", "true");
      let res;
      try { res = await sb.functions.invoke("fwfp-draft", { body: { draft: entryId } }); } catch { res = { error: { message: "unavailable" } }; }
      const { data: again } = await sb.from("entries").select("data").eq("id", entryId).maybeSingle();
      draw(again?.data || row.data, res?.data?.message || res?.error?.message || "AI drafting isn't available just now. The fields stay gaps for you to write.");
    }
    draw(row.data);
    root.scrollTo?.(0, 0);   // the draft opens at its gap list
  }

  // The demo: fixture files only, read only.
  async function openDemo(host, brand) {
    const get = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error(u + " is unavailable"); return r.json(); });
    const [definition, draft] = await Promise.all([get("demo/plans/drafts/fwfp-cant-s7.v3.json"), get("demo/plans/drafts/tussock-rise.fwfp-draft.json")]);
    host.innerHTML = render(definition, draft, brand, {});
    root.scrollTo?.(0, 0);   // the draft opens at its gap list
    wire(host);
    return draft;
  }
  function close() { if (screen && !screen.hidden) document.body?.classList.remove("plans-open"); opened++; }

  return { AI_FLAG, KIND, render, markNode, aiValues, status, keyOf, capacity, open, openDemo, close };
});
