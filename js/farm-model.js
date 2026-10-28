// Caller-scoped PDM slices -> the shared component. No DOM, network, independent fact chooser or clock.
(function (root, factory) {
  const api = factory(typeof module === "object" && module.exports ? require("./plan/templates/labels.js") : root.FP.plan.labels);
  if (typeof module === "object" && module.exports) module.exports = api; else root.FP.farmModel = api;
})(typeof window === "undefined" ? globalThis : window, function (L) {
  const list = (v) => Array.isArray(v) ? v : [];
  const words = { met: "Met", on_track: "On track", worth_checking: "Worth checking", gap: "Gap", not_applicable: "Not applicable", cant_tell_yet: "We can't tell yet" };
  const views = [["map", "Map"], ["authorisations", "Authorisations"], ["actions", "Risks & actions"], ["plans", "Plans & documents"]];
  const person = (p, fallback) => p?.by_name || p?.user_id || fallback || "author not recorded";
  const date = (d) => d && /^\d{4}-\d{2}-\d{2}/.test(d) ? new Date(d.slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "date not recorded";
  const human = (c) => c.author_kind === "advisor" && !c.superseded_at;
  const href = (f, view, id) => "#/farm/" + f + (view === "map" ? "" : "/" + view) + (id ? "?item=" + encodeURIComponent(id) : "");
  function status(c) {
    const state = c.status === "gap" && c.author_kind !== "advisor" ? "worth_checking" : c.status;
    const author = c.author_kind === "system" ? "system check, " + (c.rule_module || "module not recorded") + " v" + (c.rule_version || "?") +
      (c.confirmed_by ? ", confirmed by " + person(c.confirmation) + ", " + date(c.confirmation?.at || c.confirmed_at) : ", not yet confirmed by an advisor") :
      (c.author_kind || "author not recorded") + ": " + person(c.author, c.author_user) + ", " + date(c.created_at);
    return (words[state] || "We can't tell yet") + " — " + author + (c.inputs?.threshold_to_confirm ? "; threshold to be confirmed" : "");
  }
  const authName = (a) => [a.consent_no || a.rule_ref, a.title].filter(Boolean).join(" · ");
  function authKind(a) {
    if (a.kind !== "consent") return L.enumLabel("authorisation_kind", a.kind || "authorisation");
    return ({ land_use: "Land use consent", water_permit: "Water permit", discharge_consent: "Discharge consent",
      discharge_permit: "Discharge consent" })[a.consent_type] || "Resource consent";
  }
  const readings = [["met", "Met"], ["on_track", "On track"], ["worth_checking", "Worth checking"], ["gap", "Gap"], ["not_applicable", "Not applicable"], ["cant_tell_yet", "We can't tell yet"]];
  const decisions = {
    review_item: [["resolve", "Mark resolved"], ["dismiss", "Dismiss"]],
    unchecked_fact: [["check", "Value is right"], ["correct", "Correct it"], ["reject", "Reject it"]],
    unconfirmed_check: [["confirm", "Confirm"], ["disagree", "Read it differently"]],
    conflict: [["pin", "Use this value"]],
  };
  // review_queue rows (0031) -> cards. Order is the view's: dated, conflicts, AI values and checks, loader notes.
  function reviewRows(rows, f, byOwner) {
    return [...rows].sort((a, b) => (a.priority - b.priority) || String(a.due_on || "9999").localeCompare(String(b.due_on || "9999")) ||
      String(a.created_at).localeCompare(String(b.created_at)) || String(a.ref_id).localeCompare(String(b.ref_id))).map((r) => {
      const d = r.detail || {}, id = r.source + "-" + r.ref_id, meta = [];
      if (r.source === "unchecked_fact") meta.push({ label: "Source", value: [d.document_title, d.page ? "page " + d.page : null].filter(Boolean).join(", ") });
      if (r.source === "conflict") meta.push({ label: "Values", value: list(d.values).join(" or ") });
      if (r.due_on) meta.push({ label: "Due", value: date(r.due_on) });
      return { id, href: href(f, "review", id), text: String(r.sentence || "").replace(/, due \d{1,2} \w{3} \d{4}(?= — )/, ""),
        eligible: !!r.due_on, because: r.due_on ? "due " + date(r.due_on) : null, due_date: r.due_on, group: r.source,
        meta: meta.filter((x) => x.value), note: null,
        review: (decisions[r.source] || []).length ? { source: r.source, refId: r.ref_id, decisions: decisions[r.source], numeric: d.value_num != null, unit: d.unit || "", readings: byOwner ? readings.filter(([v]) => v !== "gap") : readings, ownerNote: !!byOwner,
          candidates: r.source === "conflict" ? list(d.candidates).filter((c) => c.fact_id).map((c) => ({ factId: c.fact_id, label: [c.value, c.unit].filter(Boolean).join(" ") + (c.source ? " — " + c.source : "") })) : [] } : null };
    });
  }
  // The overview sentences, written once: the farm home (models) and the portfolio (summaryLine) both use them.
  const say = {
    overdue: (n, overall) => ({ text: n + " actions are still recorded as planned after their due dates" + overall, because: "progress has not been confirmed here", short: n + " actions are still recorded as planned after their due dates." }),
    actions: (n, overall) => ({ text: n + " actions are recorded" + overall, because: "they form the recorded programme; current progress has not been confirmed here", short: n + " actions are recorded." }),
    overall: (o) => o ? "; overall significance " + o.text + " (" + o.assessed_by + ", " + date(o.assessed_on) + ")" : "",
    authorisations: (n, assessed) => ({ text: n + (n === 1 ? " authorisation is recorded" : " authorisations are recorded"),
      because: assessed ? "advisor assessments are shown with their authors" : "the checks still need an advisor\'s assessment", short: n + (n === 1 ? " authorisation is recorded." : " authorisations are recorded.") }),
    plans: (n, docs, cited, open) => ({ text: n + " plan version" + (n === 1 ? "" : "s") + " and " + docs + (cited ? (docs === 1 ? " cited document" : " cited documents") : (docs === 1 ? " document" : " documents")) + " recorded",
      because: open ? "a draft is waiting for review" : "signed versions preserve the agreed record",
      short: n + " plan version" + (n === 1 ? "" : "s") + " and " + docs + (cited ? (docs === 1 ? " cited document" : " cited documents") : (docs === 1 ? " document" : " documents")) + " recorded" + (open ? " — a draft is waiting for review" : "") + "." }),
    noPlan: (docs) => "No plan yet · " + docs + " documents recorded.",
  };
  function models(context) {
    const { farm, pdm: p, advisor } = context, f = farm.id;
    const reviewer = !!advisor || !!context.owner; // advisors, and the farm's owner (0037)
    const checks = list(p.checks).filter((c) => !c.superseded_at), auths = list(p.authorisations);
    const actions = list(p.actions?.programme).filter((a) => !["possible", "not_doing"].includes(a.status));
    const risks = list(p.risks), docs = list(p.documents), plans = list(context.plans);
    const at = p.as_at || context.asAt;
    const knownDate = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) && Number.isFinite(Date.parse(value));
    const sourceDates = [...docs.map((d) => d.date_prepared), ...actions.map((a) => a.source?.date_prepared)].filter(knownDate).sort();
    const frozenDate = p.plan?.signed_off_at || p.as_at;
    const currency = context.frozen ? (knownDate(frozenDate) ? "Signed plan information at " + date(frozenDate) : null) :
      sourceDates.length ? "Recorded information to " + date(sourceDates.at(-1)) : null;
    const make = (key, title, items, answer, empty, extra = {}) => ({ key, title, items, answer, empty, currency,
      isAdvisor: advisor, href: href(f, key), allLabel: "All " + (key === "plans" ? "plans and documents" : key === "actions" ? "risks and actions" : key === "review" ? "review items" : "authorisations"), ...extra });
    const authActions = [...actions, ...list(p.actions?.possible)];
    const authItems = auths.map((a) => {
      const cs = checks.filter((c) => c.authorisation_id === a.id);
      const chosen = cs.find((c) => human(c) && ["worth_checking", "gap", "cant_tell_yet"].includes(c.status));
      const expiring = at && a.valid_to && a.valid_to >= at && (Date.parse(a.valid_to) - Date.parse(at)) / 86400000 <= 90;
      const group = ["current", "future", "history"].includes(a.period_state) ? a.period_state : "recorded";
      const period = a.valid_from && a.valid_to ? date(a.valid_from) + " to " + date(a.valid_to) :
        a.valid_from ? "From " + date(a.valid_from) + " · no end date recorded" : a.valid_to ? "Until " + date(a.valid_to) + " · start date not recorded" : "Not recorded";
      const obligations = list(a.obligations).map((o) => {
        const oc = list(o.checks).filter((c) => !c.superseded_at);
        const latest = oc[0] || cs.find((c) => c.obligation_id === o.id);
        const actionIds = new Set(list(latest?.action_ids));
        return {
          id: o.id,
          title: [o.code ? (a.kind === "consent" ? "Condition " + o.code : o.code) : null, o.summary || "Recorded obligation"].filter(Boolean).join(" · "),
          check: latest ? status(latest) : "No check recorded.",
          actions: authActions.filter((x) => actionIds.has(x.id)).map((x) => ({ text: [x.map_code, x.title].filter(Boolean).join(" "), href: href(f, "actions", x.id) })),
        };
      });
      return { id: a.id, href: href(f, "authorisations", a.id), text: authName(a), eligible: !!chosen || !!expiring, cardType: "authorisation",
        because: chosen ? status(chosen) + (chosen.obligation_id ? " for a recorded condition" : " in the recorded assessment") :
          expiring ? "expires " + date(a.valid_to) : null, due_date: expiring ? a.valid_to : chosen?.due_date,
        group, kind: authKind(a), meta: [
          { label: "Period", value: period },
          { label: "Holder", value: a.holder },
          { label: "Status as published", value: a.status ? L.enumLabel("consent_status", a.status) : null },
        ].filter((x) => x.value), obligations,
        detail: [a.period_state || "recorded", a.valid_from ? "from " + date(a.valid_from) : "start date not recorded",
          a.valid_to ? "until " + date(a.valid_to) : null, a.holder, a.status,
          ...list(a.obligations).map((o) => [o.code, o.summary].filter(Boolean).join(": ")), ...cs.map(status)].filter(Boolean).join(" · ") };
    });
    const overall = list(p.values).find((v) => v.fact_type === "overall_risk_significance" && v.state === "recorded" &&
      v.class === "assessment" && v.checked?.at && v.assessed_by && v.assessed_on);
    const overallLine = overall ? "; overall significance " + (overall.text || overall.v) + " (" + overall.assessed_by + ", " + date(overall.assessed_on) + ")" : "";
    const due = actions.filter((a) => a.due_date && at && a.due_date < at && a.status !== "done");
    const landUnits = list(p.land_units), allActions = [...actions, ...list(p.actions?.possible)];
    const obligationsByAction = new Map();
    for (const a of auths) for (const o of list(a.obligations)) {
      const latest = list(o.checks).find((c) => !c.superseded_at) || checks.find((c) => c.authorisation_id === a.id && c.obligation_id === o.id);
      for (const actionId of list(latest?.action_ids)) {
        if (!obligationsByAction.has(actionId)) obligationsByAction.set(actionId, []);
        obligationsByAction.get(actionId).push({ text: [authName(a), o.code ? (a.kind === "consent" ? "Condition " + o.code : o.code) : null, o.summary].filter(Boolean).join(" · "), href: href(f, "authorisations", a.id) });
      }
    }
    const riskLine = (r) => r.author_kind !== "system" && r.assessed_by && r.assessed_on ?
      (r.description || "Recorded risk") + " — " + L.enumLabel("risk_rating", r.rating || "not_assessed") + " — " + r.assessed_by + ", " + date(r.assessed_on) :
      (r.description || "Recorded risk") + " — rating not yet assessed";
    const actionItems = allActions.map((a) => {
      const linkedRisks = risks.filter((r) => list(a.risk_ids).includes(r.id));
      const places = list(a.places), placeText = places.map((x) => x.code || x.name).filter(Boolean).join(", ");
      const possible = a.status === "possible";
      return { id: a.id, href: href(f, "actions", a.id), text: [a.map_code, a.title].filter(Boolean).join(" ") || "Recorded action",
        eligible: due.some((d) => d.id === a.id), because: a.due_date ? "due " + date(a.due_date) + "; still recorded as " + L.enumLabel("action_status", a.status || "planned").toLowerCase() : null,
        due_date: a.due_date, group: possible ? "possible" : "programme", cardType: "action", kind: L.managementArea(a.management_area), managementArea: a.management_area,
        placeIds: places.map((x) => x.id).filter(Boolean), meta: [
          { label: "Land units", value: placeText || "Not recorded" },
          { label: "Timeframe", value: a.due_date ? date(a.due_date) : a.timeframe_text || "Not recorded" },
          { label: "Status", value: L.enumLabel("action_status", a.status || (possible ? "possible" : "planned")) },
          { label: "Evidence", value: Number(a.evidence_count) ? a.evidence_count + " linked record" + (a.evidence_count === 1 ? "" : "s") : "None linked" },
        ], sections: [
          linkedRisks.length ? { title: "Risks this action reduces", items: linkedRisks.map((r) => ({ text: riskLine(r), href: href(f, "actions", r.id) })) } : null,
          obligationsByAction.has(a.id) ? { title: "Obligations this action meets", items: obligationsByAction.get(a.id) } : null,
        ].filter(Boolean), note: a.rationale ? "Why it is in the programme: " + a.rationale : null };
    });
    for (const r of risks) {
      const receptor = list(p.receptors).find((x) => x.id === r.receptor_id), assessed = r.author_kind !== "system" && r.assessed_by && r.assessed_on;
      const unit = landUnits.find((x) => x.id === r.place_id), linkedActions = allActions.filter((a) => list(a.risk_ids).includes(r.id));
      actionItems.push({ id: r.id, href: href(f, "actions", r.id), text: r.description || "Recorded risk",
        eligible: !!assessed && Number(receptor?.significance) >= 4, receptor_weight: Number(receptor?.significance) || 0,
        because: assessed && receptor ? "drains to " + receptor.name + "; assessed " + String(r.rating || "not assessed").replaceAll("_", " ") + " by " + r.assessed_by + ", " + date(r.assessed_on) : null,
        group: "risks", cardType: "risk", kind: L.managementArea(r.management_area), managementArea: r.management_area, placeIds: [r.place_id].filter(Boolean),
        meta: [
          { label: "Land unit", value: unit ? [unit.code, unit.name].filter(Boolean).join(" · ") : "Not recorded" },
          { label: "Rating", value: assessed ? L.enumLabel("risk_rating", r.rating || "not_assessed") + " — " + r.assessed_by + ", " + date(r.assessed_on) : "Not yet assessed" },
          { label: "Receptor", value: receptor?.name || "Not recorded" },
        ], sections: linkedActions.length ? [{ title: "Actions that reduce this risk", items: linkedActions.map((a) => ({ text: [a.map_code, a.title].filter(Boolean).join(" "), href: href(f, "actions", a.id) })) }] : [] });
    }
    const planItems = plans.map((plan) => ({ id: plan.id, text: [plan.title || "Farm Environment Plan", plan.version_label, plan.status?.replaceAll("_", " ")].filter(Boolean).join(" · "),
      href: "#/farm/" + f + "/plan/" + plan.id, eligible: ["draft", "in_review"].includes(plan.status), because: plan.status === "in_review" ? "submitted for review" : "draft awaiting review",
      due_date: plan.plan_date, detail: "Plan date " + date(plan.plan_date) }));
    planItems.push(...docs.map((d) => ({ id: d.id, text: d.title || "Document", href: href(f, "plans", d.id), eligible: false,
      detail: [d.doc_type, d.author, d.author_org, d.date_prepared ? date(d.date_prepared) : null].filter(Boolean).join(" · ") })));
    const queue = reviewer && Array.isArray(context.reviewQueue) ? context.reviewQueue : null;
    const reviewItems = queue ? reviewRows(queue, f, !advisor) : [];
    const total = queue ? queue.length : context.reviewCounts?.total;
    const dated = queue ? queue.map((r) => r.due_on).filter(Boolean).sort() : [];
    const reviewAnswer = !reviewer || context.reviewError || !Number.isInteger(total) || !total ? null : {
      text: total + (total === 1 ? " thing is" : " things are") + " waiting for you",
      because: dated.length ? "the earliest is due " + date(dated[0]) : "none has a due date" };
    const reviewEmpty = !reviewer ? { text: "Your farm's advisor handles review." } : context.reviewError ? { text: "The review list couldn't be read." } :
      context.reviewCounts === null && !queue ? { text: "The review count isn't available." } : { text: "Nothing is waiting for review." };
    return {
      authorisations: make("authorisations", "Authorisations", authItems,
        auths.length ? say.authorisations(auths.length, checks.some(human)) : null,
        { text: "No authorisations recorded.", startBy: "recording the farm's activities and the consents or rules they rely on." },
        { cards: true, groups: [["current", "Current"], ["future", "Future"], ["history", "History"], ["recorded", "Period not recorded"]] }),
      actions: make("actions", "Risks & actions", actionItems,
        due.length ? say.overdue(due.length, overallLine) : actions.length ? say.actions(actions.length, overallLine) : null,
        { text: context.assemblyMissing ? "No risks or actions recorded yet." : "No risks or actions recorded.", startBy: "looking at the farm's activities with its advisor." },
        { rank: due.length ? "due_date" : "receptor_weight", cards: true,
          groups: [["programme", "Programme"], ["possible", "Possible actions"], ["risks", "Recorded risks"]],
          filters: {
            managementAreas: [...new Set(actionItems.map((x) => x.managementArea).filter(Boolean))].sort().map((key) => ({ value: key, label: L.managementArea(key) })),
            landUnits: landUnits.map((u) => ({ value: u.id, label: [u.code, u.name].filter(Boolean).join(" · ") || "Recorded land unit" })),
          } }),
      plans: make("plans", "Plans & documents", planItems,
        plans.length ? say.plans(plans.length, docs.length, !context.uncited, plans.some((x) => ["draft", "in_review"].includes(x.status))) : null,
        { text: say.noPlan(docs.length), startBy: "reading the existing documents, then starting a draft when ready." },
        { startAction: context.canEdit ? "Start a new plan version" : null }),
      review: make("review", "Review", reviewItems, reviewAnswer, reviewEmpty,
        { restricted: !reviewer || !!context.reviewError || (!!queue && !queue.length) || (!queue && total === 0), cards: true, rank: "given", noCount: !queue, openAll: !!queue, allLabel: "All review items",
          groups: [["unconfirmed_check", "Checks to confirm"], ["unchecked_fact", "Values read from documents"], ["conflict", "Recorded more than one way"], ["review_item", "Notes from the import"]] }),
    };
  }
  // One sentence per farm for the portfolio, from the same overview models the farm home uses.
  function portfolioLine(context) {
    const m = models(context);
    for (const key of ["actions", "authorisations", "plans"]) {
      const a = m[key].answer;
      if (a?.short) return a.short;
    }
    return m.plans.empty.text;
  }
  // The same sentence from a farm_summaries row (0038), so the portfolio needn't open each farm's full record.
  function summaryLine(s) {
    const overall = say.overall(s.overall_significance);
    for (const a of [Number(s.overdue_actions) ? say.overdue(Number(s.overdue_actions), overall) : Number(s.programme_actions) ? say.actions(Number(s.programme_actions), overall) : null,
      Number(s.authorisation_count) ? say.authorisations(Number(s.authorisation_count), !!s.advisor_checked) : null,
      Number(s.plan_count) ? say.plans(Number(s.plan_count), Number(s.document_count), true, Number(s.open_plan_count) > 0) : null])
      if (a?.short) return a.short;
    return say.noPlan(Number(s.document_count));
  }
  function match(hash) {
    const m = String(hash || "").match(/^#\/farm\/([0-9a-f-]{36})(?:\/(authorisations|actions|plans|review)|\/plan\/([0-9a-f-]{36}))?(?:\?item=([^&#]+))?$/);
    try { return m ? { farm: m[1], view: m[3] ? "reader" : m[2] || "map", plan: m[3] || null, item: m[4] ? decodeURIComponent(m[4]) : null } : null; } catch { return null; }
  }
  return { models, portfolioLine, summaryLine, match, href, views, status, date, reviewRows };
});

