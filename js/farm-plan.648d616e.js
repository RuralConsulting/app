// FEP1: a farm's Plan page (#/farm/<id>/plan) and its row on the farm's Home. What the plan said, as at its date, read only: land
// units with their use and ratings, the actions the plan ticked with its own By when and Progress, each to its PDF page. The words and
// the rules are farm-plan-model.js; this file reads and draws.
//
// Who: RCL staff, and a coordinator (facilitator, advisor, admin) of a catchment group the farm is actively associated with (HV1). A
// farm's own people never get the row or the page in version 1 (the owner's ruling): decided here, in the app, by who the person is,
// before anything of the plan is read. The database has always let a farm's own people read these rows; hiding them is this rule.
//
// Reads (as the signed-in person; row-level security decides what comes back; nothing is written, no function is called):
//   farm_group_associations  org_id, status: this farm's active associations, only for a person who coordinates a group (at most 50)
//   risks, actions, activities  a head count each, for the Home row (only for staff and coordinators)
//   the page, in one wave: land_units (the view: id, code, name, description, area_ha), activities, risks, actions (never their
//   status or due date), action_places, action_risks, and the farm's plan files (documents of a plan type), each by farm_id and capped
//   (farm-plan-model.js CAPS: one more row than the cap is asked for, so the page can say when a farm has more).
(function (root) {
  const FP = root.FP;
  const P = () => FP.farmPlanModel;
  const el = (...a) => FP.el(...a);
  let shown = null;   // the page drawn now: { alive }

  // ---- who ------------------------------------------------------------------------------------------------------------------------
  // who: a promise of { role (the person's farm role, or null), staff, groups (the person's catchment groups with their role) }.
  // Fails closed: a who that could not be worked out (the farm-role read failed: "no role" and "couldn't read" are never the same), or
  // an association read that failed, THROWS ("couldn't be read just now"); null means this person may not see the page.
  async function audienceFor(sb, farm, who) {
    const w = await Promise.resolve(who);
    if (!w) throw new Error("who the person is could not be read");
    if (w.staff === true) return "staff";
    // (the staff flag not read: a "no" here is not certain, since the person may be RCL staff; so it is "couldn't be read")
    const no = () => { if (w.staffKnown === false) throw new Error("the staff flag could not be read"); return null; };
    if (w.role) return no();   // one of the farm's own people: nothing is read
    if (!P().coordinatedGroupIds(w.groups).size) return no();   // coordinates no group: nothing is read
    const r = await Promise.resolve(sb.from("farm_group_associations").select("org_id,status").eq("farm_id", farm.id).eq("status", "active").limit(50));
    if (!r || r.error) throw r?.error || new Error("the farm's groups could not be read");
    return P().audience({ staff: false, farmRole: null, groups: w.groups, associations: r.data || [] }) || no();
  }
  // (a head read's count; the demo's stand-in gives it as the API does)
  const headCount = (q) => Promise.resolve(q).then((r) => (r?.error ? null : Number.isInteger(r?.count) ? r.count : Array.isArray(r?.data) ? r.data.length : null), () => null);
  // Whether the farm has plan records the person can read: ratings, actions or land-unit uses
  async function hasRecords(sb, farmId) {
    const n = await Promise.all(["risks", "actions", "activities"].map((t) => headCount(sb.from(t).select("id", { count: "exact", head: true }).eq("farm_id", farmId))));
    return n.some((x) => Number(x) > 0);
  }
  // The row on the farm's Home, beside Maps and Files: a promise of the row, or null (not this person, or no plan records)
  async function homeRow(farm, { sb = FP.sb, who } = {}) {
    try {
      if (!(await audienceFor(sb, farm, who))) return null;
      if (!(await hasRecords(sb, farm.id))) return null;
      return { key: "plan", label: P().WORDS.rowLabel, line: P().WORDS.rowLine, icon: "plan", href: FP.href(FP.farmModel.href(farm.id, "plan")), after: "documents" };
    } catch { return null; }
  }

  // ---- the reads ------------------------------------------------------------------------------------------------------------------
  // Each capped read asks for one row more than its cap: more back means the farm has more, and only the cap is used.
  function capped(query, cap) {
    return Promise.resolve(query.limit(cap + 1)).then((r) => {
      if (r?.error) throw r.error;
      const rows = Array.isArray(r?.data) ? r.data : [];
      return { rows: rows.slice(0, cap), more: rows.length > cap };
    });
  }
  const soft = (p) => p.catch(() => ({ rows: [], more: false }));
  function readPlan(sb, farmId) {
    const C = P().CAPS, by = (t, cols) => sb.from(t).select(cols).eq("farm_id", farmId);
    const reads = {
      landUnits: capped(by("land_units", "id,code,name,description,area_ha").order("code"), C.landUnits),
      activities: capped(by("activities", "id,place_id,name,description"), C.activities),
      risks: capped(by("risks", "id,place_id,activity_id,pathway,contaminants,description"), C.risks),
      actions: capped(by("actions", "id,title,description,rationale,place_id,source_document_id,source_page"), C.actions),
      // the links and the plan file are a help, not the page: if they can't be read, the page still says what the plan said
      actionPlaces: soft(capped(by("action_places", "action_id,place_id"), C.actionPlaces)),
      actionRisks: soft(capped(by("action_risks", "action_id,risk_id"), C.actionRisks)),
      files: soft(capped(by("documents", "id,title,original_name,doc_type,date_prepared,storage_path,status").in("doc_type", P().PLAN_TYPES), C.files)),
    };
    const keys = Object.keys(reads);
    return Promise.all(keys.map((k) => reads[k])).then((got) => {
      const out = { capped: {} };
      keys.forEach((k, i) => { out[k] = got[i].rows; if (got[i].more) out.capped[k] = true; });
      return out;
    });
  }

  // ---- opening the plan file ------------------------------------------------------------------------------------------------------
  // As Files opens a file: a signed link for an hour, in a new tab; at a page where one is given (a PDF viewer's #page=)
  async function openFile(sb, file, page, button) {
    if (!file?.path) return;
    if (button) button.disabled = true;
    const { data, error } = await Promise.resolve(sb.storage.from("documents").createSignedUrl(file.path, 3600)).catch((e) => ({ error: e }));
    if (button) button.disabled = false;
    if (error || !data?.signedUrl) { if (button) { button.setAttribute("data-failed", ""); button.textContent = "Couldn't open it"; } return; }
    root.open(data.signedUrl + (Number.isInteger(page) && page > 0 ? "#page=" + page : ""), "_blank", "noopener");
  }

  // ---- drawing --------------------------------------------------------------------------------------------------------------------
  const W = () => P().WORDS;
  function pageButton(sb, file, page, what) {
    if (!file?.path || !page) return null;
    return el("button", { type: "button", class: "fp-page", "data-pdf-page": String(page), "aria-label": "Open the plan at PDF page " + page + (what ? ", " + what : ""),
      onclick: (e) => openFile(sb, file, page, e.currentTarget) }, "p. " + page);
  }
  function riskRow(r) {
    return el("li", { class: "fp-row", "data-risk": r.id || "" },
      el("span", { class: "fp-row-text" }, el("b", {}, r.name), r.sentence ? el("small", { class: "fp-said" }, r.sentence) : null),
      r.rating ? el("span", { class: "fp-pill", "data-rating": "" }, r.rating) : null);
  }
  function unitBlock(sb, file, u) {
    const title = [u.code, u.name].filter(Boolean).join(" · ");
    const facts = [P().areaText(u.area)].filter(Boolean);
    return el("li", { class: "fp-unit", "data-land-unit": u.id },
      el("div", { class: "fp-unit-head" },
        el("span", { class: "fp-row-text" }, el("h3", {}, title), facts.length ? el("small", {}, facts.join(" · ")) : null),
        pageButton(sb, file, u.page, title)),
      ...u.uses.map((w) => el("p", { class: "fp-use" }, el("span", { class: "fp-label" }, "Use: "), el("span", { "data-plan-words": "" }, w.text))),
      u.risks.length ? el("ul", { class: "fp-rows", "aria-label": "Risk ratings for " + title }, ...u.risks.map(riskRow)) : el("p", { class: "fp-quiet" }, W().noRatings));
  }
  function actionRow(sb, file, a) {
    const words = [a.byWhen != null ? el("span", {}, el("span", { class: "fp-label" }, "By when: "), el("span", { "data-plan-words": "by-when" }, a.byWhen)) : null,
      a.progress != null ? el("span", {}, el("span", { class: "fp-label" }, P().progressLabel + ": "), el("span", { "data-plan-words": "progress" }, a.progress)) : null].filter(Boolean);
    const units = a.landUnits.map((u) => u.name);
    return el("li", { class: "fp-row fp-action", "data-action": a.id || "" },
      el("span", { class: "fp-row-text" },
        el("b", { "data-plan-words": "title" }, a.title),
        words.length ? el("small", { class: "fp-words" }, ...words.flatMap((w, i) => (i ? [el("span", { "aria-hidden": "true" }, " · "), w] : [w]))) : el("small", { "data-said": a.said }, a.said === "none" ? W().noWords : W().seePlan + (a.page ? " (p. " + a.page + ")" : "")),
        units.length ? el("small", {}, el("span", { class: "fp-label" }, (units.length === 1 ? "Land unit: " : "Land units: ")), units.join(", ")) : null,
        a.risks.length ? el("small", {}, el("span", { class: "fp-label" }, "For the rating: "), a.risks.join("; ")) : null,
        a.comment ? el("small", {}, el("span", { class: "fp-label" }, "Comment in the plan: "), el("span", { "data-plan-words": "comment" }, a.comment)) : null),
      pageButton(sb, file, a.page, a.title));
  }
  function draw(host, sb, farm, m) {
    const head = el("header", { class: "fp-head" },
      el("a", { class: "fp-back", href: FP.href(FP.farmModel.href(farm.id, "home")) }, FP.icon("back", 16), el("span", {}, "Home")),
      el("h1", { id: "fp-title" }, farm.name),
      el("p", { class: "fp-asat" }, P().heading(m.dateText)),
      m.file ? el("p", { class: "fp-file" }, FP.icon("plan", 18),
        m.file.path ? el("button", { type: "button", class: "fp-file-open", onclick: (e) => openFile(sb, m.file, null, e.currentTarget) }, m.file.name) : el("span", {}, m.file.name)) : null,
      el("ul", { class: "fp-counts", "aria-label": "In this plan" }, ...P().countLine(m.counts).map((t) => el("li", {}, t))));
    const parts = [head];
    const cap = P().cappedLine(m.capped);
    if (cap) parts.push(el("p", { class: "fp-note fp-capped", role: "note" }, cap));
    if (m.landUnits.length) {
      parts.push(el("section", { class: "fp-section", "aria-labelledby": "fp-units" }, el("h2", { id: "fp-units" }, W().landUnitsTitle), el("p", { class: "fp-note" }, W().landUnitsNote),
        el("ul", { class: "fp-units" }, ...m.landUnits.map((u) => unitBlock(sb, m.file, u)))));
    }
    if (m.loose.length) parts.push(el("section", { class: "fp-section" }, el("h2", {}, W().looseTitle), el("ul", { class: "fp-rows" }, ...m.loose.map(riskRow))));
    if (m.actions.length) {
      parts.push(el("section", { class: "fp-section", "aria-labelledby": "fp-actions" }, el("h2", { id: "fp-actions" }, W().actionsTitle), el("p", { class: "fp-note" }, W().actionsNote),
        ...m.actions.map((g) => el("div", { class: "fp-group" }, g.title ? el("h3", {}, g.title) : null, el("ul", { class: "fp-rows" }, ...g.items.map((a) => actionRow(sb, m.file, a)))))));
    }
    parts.push(el("footer", { class: "fp-foot" }, ...W().foot.map((t) => el("p", {}, t))));
    host.replaceChildren(el("article", { class: "farm-plan", "aria-labelledby": "fp-title" }, ...parts));
  }
  function message(host, farm, text) {
    host.replaceChildren(el("article", { class: "farm-plan" },
      el("header", { class: "fp-head" }, el("a", { class: "fp-back", href: FP.href(FP.farmModel.href(farm.id, "home")) }, FP.icon("back", 16), el("span", {}, "Home")),
        el("h1", {}, farm.name), el("p", { class: "fp-asat", role: "status" }, text))));
  }
  // host: the screen; opts: { farm, sb, who (as homeRow) }
  async function open(host, { farm, sb = FP.sb, who } = {}) {
    close();
    const me = { alive: true, host };
    shown = me;
    const live = () => me.alive && shown === me;
    message(host, farm, W().loading);
    host.scrollTop = 0;
    let rows;
    try {
      if (!(await audienceFor(sb, farm, who))) { if (live()) message(host, farm, W().notYours); return; }
      rows = await readPlan(sb, farm.id);
    } catch { if (live()) message(host, farm, W().failed); return; }
    if (!live()) return;
    const m = P().build(rows);
    if (m.empty) { message(host, farm, W().none); return; }
    draw(host, sb, farm, m);
  }
  // (and nothing of a plan stays in the hidden page once it is left)
  function close() { if (shown) { shown.alive = false; shown.host?.replaceChildren(); } shown = null; }

  FP.farmPlan = { open, close, homeRow, audienceFor, readPlan, hasRecords };
})(typeof window === "undefined" ? globalThis : window);
