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
  function models(context) {
    const { farm, pdm: p, advisor } = context, f = farm.id;
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
      return { id: a.id, href: href(f, "authorisations", a.id), text: authName(a), eligible: !!chosen || !!expiring,
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
    const actionItems = [...actions, ...list(p.actions?.possible)].map((a) => ({
      id: a.id, href: href(f, "actions", a.id), text: [a.map_code, a.title].filter(Boolean).join(" "),
      eligible: due.some((d) => d.id === a.id), because: a.due_date ? "due " + date(a.due_date) + "; still recorded as " + String(a.status || "planned").replaceAll("_", " ") : null,
      due_date: a.due_date, detail: [a.status?.replaceAll("_", " "), a.timeframe_text, a.rationale,
        ...list(a.places).map((x) => x.code || x.name)].filter(Boolean).join(" · "),
    }));
    for (const r of risks) {
      const receptor = list(p.receptors).find((x) => x.id === r.receptor_id), assessed = r.author_kind !== "system" && r.assessed_by && r.assessed_on;
      actionItems.push({ id: r.id, href: href(f, "actions", r.id), text: r.description || "Recorded risk",
        eligible: !!assessed && Number(receptor?.significance) >= 4, receptor_weight: Number(receptor?.significance) || 0,
        because: assessed && receptor ? "drains to " + receptor.name + "; assessed " + String(r.rating || "not assessed").replaceAll("_", " ") + " by " + r.assessed_by + ", " + date(r.assessed_on) : null,
        detail: assessed ? "Assessed " + String(r.rating || "not assessed").replaceAll("_", " ") + " by " + r.assessed_by + ", " + date(r.assessed_on) : "Not yet assessed" });
    }
    const planItems = plans.map((plan) => ({ id: plan.id, text: [plan.title || "Farm Environment Plan", plan.version_label, plan.status?.replaceAll("_", " ")].filter(Boolean).join(" · "),
      href: "#/farm/" + f + "/plan/" + plan.id, eligible: ["draft", "in_review"].includes(plan.status), because: plan.status === "in_review" ? "submitted for review" : "draft awaiting review",
      due_date: plan.plan_date, detail: "Plan date " + date(plan.plan_date) }));
    planItems.push(...docs.map((d) => ({ id: d.id, text: d.title || "Document", href: href(f, "plans", d.id), eligible: false,
      detail: [d.doc_type, d.author, d.author_org, d.date_prepared ? date(d.date_prepared) : null].filter(Boolean).join(" · ") })));
    const reviewItems = [];
    if (advisor) {
      for (const v of list(p.values)) if (v.state === "awaiting_check" || v.flagged) {
        const type = L.factType(v.fact_type || "Recorded value");
        reviewItems.push({ id: "fact-" + (v.fact_id || type), text: type[0].toUpperCase() + type.slice(1), href: href(f, "review", "fact-" + (v.fact_id || type)),
          eligible: true, because: v.state === "awaiting_check" ? "extracted value awaits an advisor check" : "recorded sources disagree", detail: "Review the source; no value is asserted here." });
      }
      for (const c of checks) if (c.author_kind !== "advisor" && !c.confirmed_by || c.inputs?.threshold_to_confirm) {
        const id = "check-" + c.id;
        reviewItems.push({ id, text: authName(auths.find((a) => a.id === c.authorisation_id) || {}) || "Recorded check",
          href: href(f, "review", id), eligible: true, because: c.inputs?.threshold_to_confirm ? "threshold needs confirmation" : "check awaits advisor confirmation",
          detail: status(c) });
      }
      for (const [key, s] of Object.entries(p.sections || {})) if (s.state === "draft" && s.body) {
        const id = "text-" + key;
        reviewItems.push({ id, text: L.section(key), href: href(f, "review", id), eligible: true,
          because: "draft text has not been saved as written" });
      }
    }
    return {
      authorisations: make("authorisations", "Authorisations", authItems,
        auths.length ? { text: auths.length + (auths.length === 1 ? " authorisation is recorded" : " authorisations are recorded"), because: checks.some(human) ? "advisor assessments are shown with their authors" : "the checks still need an advisor\'s assessment" } : null,
        { text: "No authorisations recorded.", startBy: "recording the farm's activities and the consents or rules they rely on." },
        { cards: true, groups: [["current", "Current"], ["future", "Future"], ["history", "History"], ["recorded", "Period not recorded"]] }),
      actions: make("actions", "Risks & actions", actionItems,
        due.length ? { text: due.length + " actions are still recorded as planned after their due dates" + overallLine } :
          actions.length ? { text: actions.length + " actions are recorded" + overallLine, because: "they form the recorded programme; current progress has not been confirmed here" } : null,
        { text: context.assemblyMissing ? "No risks or actions recorded yet." : "No risks or actions recorded.", startBy: "looking at the farm's activities with its advisor." },
        { rank: due.length ? "due_date" : "receptor_weight" }),
      plans: make("plans", "Plans & documents", planItems,
        plans.length ? { text: plans.length + " plan version" + (plans.length === 1 ? "" : "s") + " and " + docs.length + (context.uncited ? (docs.length === 1 ? " document" : " documents") : (docs.length === 1 ? " cited document" : " cited documents")) + " recorded", because: plans.some((x) => ["draft", "in_review"].includes(x.status)) ? "a draft is waiting for review" : "signed versions preserve the agreed record" } : null,
        { text: "No plan yet · " + docs.length + " documents recorded.", startBy: "reading the existing documents, then starting a draft when ready." },
        { startAction: context.canEdit ? "Start a new plan version" : null }),
      review: make("review", "Review", reviewItems,
        advisor && reviewItems.length ? { text: reviewItems.length + (reviewItems.length === 1 ? " recorded item needs" : " recorded items need") + " an advisor's look", because: "they await checking or confirmation" } : null,
        { text: advisor ? "No review items identified in the recorded information." : "Your farm's advisor handles review.", startBy: advisor && !plans.length ? "reading the recorded documents." : null },
        { restricted: !advisor }),
    };
  }
  function match(hash) {
    const m = String(hash || "").match(/^#\/farm\/([0-9a-f-]{36})(?:\/(authorisations|actions|plans|review)|\/plan\/([0-9a-f-]{36}))?(?:\?item=([^&#]+))?$/);
    try { return m ? { farm: m[1], view: m[3] ? "reader" : m[2] || "map", plan: m[3] || null, item: m[4] ? decodeURIComponent(m[4]) : null } : null; } catch { return null; }
  }
  return { models, match, href, views, status, date };
});
