// Farm-space routes and the models the answer component renders. No DOM, network or clock: "today" is passed in.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api; else root.FP.farmModel = api;
})(typeof window === "undefined" ? globalThis : window, function () {
  const list = (v) => Array.isArray(v) ? v : [];
  // A farm space is a map with three things you can do (docs/PRODUCT-BRIEF.md "AI is the interface").
  const views = [["ask", "Ask"], ["create", "Create"], ["documents", "Documents"]];
  const outputs = [["fep", "Farm Environment Plan"], ["fwfp", "Freshwater Farm Plan"], ["consent", "Consent summary"],
    ["nzfap", "NZFAP+ walkthrough"], ["catchment", "Catchment story"]];
  const isDate = (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d) && Number.isFinite(Date.parse(d.slice(0, 10)));
  const date = (d) => isDate(d) ? new Date(d.slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "date not recorded";
  const day = (d) => isDate(d) ? d.slice(0, 10) : null;
  const addDays = (d, n) => new Date(Date.parse(d.slice(0, 10) + "T12:00:00Z") + n * 86400000).toISOString().slice(0, 10);
  // Places reached from the header rather than the three actions: People is for a farm's owner and admins.
  const otherViews = [["people", "People"]];
  const viewLabel = (key) => [...views, ...otherViews].find(([k]) => k === key)?.[1] || null;
  const href = (f, view, id) => "#/farm/" + f + (view && view !== "map" ? "/" + view : "") + (id ? "?item=" + encodeURIComponent(id) : "");
  function match(hash) {
    const m = String(hash || "").match(/^#\/farm\/([0-9a-f-]{36})(?:\/(ask|create|documents|people))?(?:\?item=([^&#]+))?$/);
    try { return m ? { farm: m[1], view: m[2] || "map", item: m[3] ? decodeURIComponent(m[3]) : null } : null; } catch { return null; }
  }
  const authName = (a) => [a.consent_no || a.rule_ref, a.title].filter(Boolean).join(" · ") || "Recorded authorisation";
  const count = (n, one, many) => (n === 1 ? "One " + one : n + " " + many);
  const docKinds = { fep: "Farm Environment Plan", fwfp: "Freshwater Farm Plan", consent_decision: "Consent decision", overseer_report: "Nutrient budget",
    memo: "Notes", aee: "Assessment of environmental effects", luc_report: "Land use capability report" };
  const docKind = (k) => docKinds[k] || (k ? String(k).replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase()) : null);

  // "What's due": dated obligations and authorisation expiry dates, as recorded. Nothing is inferred.
  // Dates in the next twelve months are promoted; later, undated and earlier ones stay in All.
  function due(context) {
    const f = context.farm.id, today = context.today, horizon = addDays(today, 365), auths = list(context.authorisations);
    const byId = new Map(auths.map((a) => [a.id, a]));
    const items = [];
    for (const o of list(context.obligations)) {
      const a = byId.get(o.authorisation_id), when = day(o.due_date);
      items.push({ id: "obligation-" + o.id, text: o.summary || "Recorded condition", due_date: when, verb: "due",
        detail: [a ? authName(a) : null, o.code ? "condition " + o.code : null, when ? (when < today ? "was due " : "due ") + date(when) : null, o.recurrence].filter(Boolean).join(" · ") });
    }
    for (const a of auths) {
      const when = day(a.valid_to);
      if (when) items.push({ id: "expiry-" + a.id, text: authName(a), due_date: when, verb: "expires",
        detail: (when < today ? "expired " : "expires ") + date(when) });
    }
    const soon = (i) => i.due_date && i.due_date >= today && i.due_date <= horizon, byDate = (a, b) => a.due_date.localeCompare(b.due_date) || a.id.localeCompare(b.id);
    const upcoming = items.filter(soon).sort(byDate), later = items.filter((i) => i.due_date && i.due_date > horizon).sort(byDate);
    const earlier = items.filter((i) => i.due_date && i.due_date < today).sort((a, b) => b.due_date.localeCompare(a.due_date));
    const undated = items.filter((i) => !i.due_date);
    for (const i of upcoming) { i.eligible = true; i.because = i.verb + " " + date(i.due_date); }
    const next = upcoming[0];
    const answer = context.obligationsError ? null : next ? { text: count(upcoming.length, "recorded date is coming up", "recorded dates are coming up"), because: "the next is " + next.text + ", " + next.verb + " " + date(next.due_date) } :
      items.length ? { text: "No recorded dates are coming up", because: earlier.length ? count(earlier.length, "earlier date is on record", "earlier dates are on record") : "the recorded conditions have no dates" } : null;
    return { key: "due", title: "What's due", rank: "given", items: [...upcoming, ...later, ...undated, ...earlier], answer, href: null, allLabel: "Everything recorded",
      empty: { text: context.obligationsError ? "The condition dates couldn't be read." : "Nothing recorded yet." },
      restricted: !items.length, currency: "As at " + date(today), farm: f };
  }

  // "What's changed": records added to the farm, newest first, from their recorded creation time.
  function changed(context) {
    const f = context.farm.id, today = context.today, since = addDays(today, -30);
    const items = [
      ...list(context.documents).map((d) => ({ id: "document-" + d.id, text: d.title || "Document", href: href(f, "documents", d.id), added: day(d.created_at), kind: "document" })),
      ...list(context.authorisations).map((a) => ({ id: "authorisation-" + a.id, text: authName(a), added: day(a.created_at), kind: "authorisation" })),
    ].sort((a, b) => String(b.added || "").localeCompare(String(a.added || "")) || a.id.localeCompare(b.id));
    for (const i of items) {
      i.detail = i.added ? "added " + date(i.added) : "date added not recorded";
      if (i.added && i.added >= since && i.added <= today) { i.eligible = true; i.because = "added " + date(i.added); }
    }
    const recent = items.filter((i) => i.eligible), latest = items.find((i) => i.added);
    const answer = recent.length ? { text: count(recent.length, "record was added in the last 30 days", "records were added in the last 30 days"), because: "the latest is " + recent[0].text + ", " + recent[0].because } :
      latest ? { text: "Nothing was added in the last 30 days", because: "the latest record is " + latest.text + ", added " + date(latest.added) } : null;
    return { key: "changed", title: "What's changed", rank: "given", items, answer, href: null, allLabel: "Everything recorded",
      empty: { text: "Nothing recorded yet." }, restricted: !items.length, currency: "As at " + date(today), farm: f };
  }

  // The standing questions whose answers show when a farm opens.
  const standingAnswers = (context) => [due(context), changed(context)];

  // Documents: the sources, by who prepared them.
  function documents(context) {
    const f = context.farm.id, docs = list(context.documents);
    const owner = (d) => d.author_org || d.author || "Not recorded";
    const owners = [...new Set(docs.map(owner))].sort((a, b) => (a === "Not recorded") - (b === "Not recorded") || a.localeCompare(b));
    const items = docs.map((d) => ({ id: d.id, text: d.title || "Document", href: href(f, "documents", d.id), group: owner(d), kind: docKind(d.doc_type),
      prepared: day(d.date_prepared), open: !!d.storage_path,
      meta: [{ label: "Prepared by", value: [d.author, d.author_org].filter(Boolean).join(", ") || "Not recorded" },
        { label: "Date", value: d.date_prepared ? date(d.date_prepared) : "Not recorded" },
        { label: "Pages", value: d.page_count ? String(d.page_count) : null }].filter((m) => m.value) }))
      .sort((a, b) => String(b.prepared || "").localeCompare(String(a.prepared || "")) || a.text.localeCompare(b.text));
    const latest = items.find((i) => i.prepared);
    const answer = items.length ? { text: count(items.length, "document is recorded", "documents are recorded"),
      because: latest ? "the most recent is " + latest.text + ", " + date(latest.prepared) : "none has a recorded date" } : null;
    return { key: "documents", title: "Documents", items, answer, rank: "given", cards: true, openAll: true, allLabel: "All documents",
      groups: owners.map((o) => [o, o]), empty: { text: "Nothing recorded yet." }, restricted: !items.length };
  }

  // One sentence per farm for the portfolio, from farm_summaries (0038) counts alone.
  function summaryLine(s) {
    const overdue = Number(s.overdue_actions) || 0, auths = Number(s.authorisation_count) || 0, docs = Number(s.document_count) || 0;
    if (overdue) return count(overdue, "action is past its recorded date.", "actions are past their recorded dates.");
    const parts = [auths ? (auths === 1 ? "1 authorisation" : auths + " authorisations") : null, docs ? (docs === 1 ? "1 document" : docs + " documents") : null].filter(Boolean);
    return parts.length ? parts.join(" and ") + " recorded." : "Nothing recorded yet.";
  }
  // The same sentence from an opened farm's own reads.
  const portfolioLine = (context) => summaryLine({ authorisation_count: list(context.authorisations).length, document_count: list(context.documents).length });

  // People on a farm (farm_people rows), for its owner and admins. Owners are changed through RCL (A1), and
  // nobody changes or removes themselves here, so neither row offers those controls.
  const roles = [["view", "View"], ["edit", "Edit"], ["admin", "Admin"]];
  const roleNames = { owner: "Owner", admin: "Admin", edit: "Edit", view: "View" };
  const canManage = (role) => role === "owner" || role === "admin";
  function people(rows, today) {
    return list(rows).map((r) => ({
      id: r.user_id, email: r.email || "No email recorded", name: r.display_name || null, role: r.role, roleName: roleNames[r.role] || r.role,
      you: !!r.is_you, editable: r.role !== "owner" && !r.is_you,
      note: [r.is_you ? "you" : null, r.signed_in === false ? "hasn't signed in yet" : null,
        isDate(r.added_at) && day(r.added_at) !== today ? "added " + date(r.added_at) : isDate(r.added_at) ? "added today" : null].filter(Boolean).join(" · "),
    }));
  }

  return { views, otherViews, viewLabel, outputs, match, href, date, standingAnswers, documents, summaryLine, portfolioLine, roles, canManage, people };
});
