// ON1 — the Onboarding view: the guided checklist of the onboarding readiness report (docs/ONBOARDING-REPORT.md). It reads
// public.onboarding_report_inputs as the person (row-level security decides), applies the rules in FP.onboardingModel, and
// draws the report. A person ticks what they have looked at (kept in this browser until saved), records the minutes they
// spent, and saves the report to the farm's Documents (doc_type onboarding_report, private when it lists a private
// document). A saved report opens here as it was saved. Nothing else is written: each proposal is confirmed in the flow
// that owns it (Add a block, What's due's Fetch conditions, an advisor's plan read-in and consent register). No AI.
// html() is pure (report in, HTML out) and tested in node; mount() is the browser's.
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else { root.FP = root.FP || {}; root.FP.onboarding = api; }
})(typeof window === "undefined" ? globalThis : window, function (root) {
  const model = () => (typeof module === "object" && module.exports ? require("./onboarding-model.js") : root.FP.onboardingModel);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const list = (v) => Array.isArray(v) ? v : [];
  const LABELS = { found: "Found", done: "Done", propose: "To confirm", verify: "To check", gap: "Missing", unavailable: "Not available" };
  const VERDICT_WORDS = { correct: "seen, correct", not_ours: "not the farm's", seen: "seen, to follow up" };
  const dates = new Intl.DateTimeFormat("en-NZ", { day: "numeric", month: "short", year: "numeric", timeZone: "Pacific/Auckland" });
  const when = (d) => (d && Number.isFinite(Date.parse(d)) ? dates.format(new Date(d)) : null);
  const TICKABLE = ["propose", "verify", "gap"];

  function sourceText(s) {
    if (!s) return null;
    if (s.kind === "document") return "From " + s.title + (s.date ? ", " + s.date : "");
    if (s.kind === "reference") return [s.name, s.licence, s.as_at ? "as at " + s.as_at : null].filter(Boolean).join(" · ");
    if (s.kind === "function") return "Worked out by the platform (" + s.name + ")";
    return null;
  }
  function itemHtml(i, o) {
    const sources = [i.source, ...list(i.sources)].filter(Boolean).map(sourceText).filter(Boolean);
    const props = i.proposals ? '<p class="onboarding-sub">' + (i.proposals.kind === "confirm_report" ? "Proposed values (an advisor accepts each)" : "Values read from the plan") + '</p><ul class="onboarding-values">' +
      list(i.proposals.values).map((v) => "<li><span>" + esc(v.label) + "</span> <b>" + esc(v.value) + "</b>" + (v.accepted === true ? " · accepted" : v.accepted === false ? " · not yet accepted" : "") + "</li>").join("") +
      (i.proposals.total > list(i.proposals.values).length ? "<li>and " + (i.proposals.total - list(i.proposals.values).length) + " more</li>" : "") + "</ul>" : "";
    const action = i.action && !o.saved ? (i.action.kind === "advisor" ? '<p class="onboarding-who">For an advisor to do.</p>' :
      '<p><button type="button" class="onboarding-go" data-onboarding-action="' + esc(i.action.kind) + '"' + (i.action.item ? ' data-onboarding-item="' + esc(i.action.item) + '"' : "") + ">" + esc(i.action.label) + "</button></p>") : "";
    const c = i.checked;
    const checked = c ? '<p class="onboarding-checked">Checked: ' + esc(VERDICT_WORDS[c.verdict] || c.verdict) + (c.note ? " · " + esc(c.note) : "") + (when(c.at) ? " · " + esc(when(c.at)) : "") + "</p>" : "";
    const stale = i.stale_tick ? '<p class="onboarding-stale">Ticked before (' + esc(VERDICT_WORDS[i.stale_tick.verdict] || "") + "), but what it rests on has changed since: look again.</p>" : "";
    const tick = o.canTick && !o.saved && TICKABLE.includes(i.state) ? (c ? '<p><button type="button" data-onboarding-untick="' + esc(i.key) + '">Undo the tick</button></p>' :
      '<div class="onboarding-tick"><label class="visually-hidden" for="ob-note-' + esc(i.key) + '">Note</label><input type="text" maxlength="500" id="ob-note-' + esc(i.key) + '" data-onboarding-note="' + esc(i.key) + '" placeholder="Note (optional)">' +
      '<button type="button" data-onboarding-tick="' + esc(i.key) + '" data-verdict="correct">Seen, correct</button><button type="button" data-onboarding-tick="' + esc(i.key) + '" data-verdict="not_ours">Not the farm\'s</button>' +
      '<button type="button" data-onboarding-tick="' + esc(i.key) + '" data-verdict="seen">To follow up</button></div>') : "";
    const body = (i.detail ? '<p class="onboarding-detail">' + esc(i.detail) + "</p>" : "") + props + sources.map((s) => '<p class="onboarding-source">' + esc(s) + "</p>").join("") + stale + checked + action + tick;
    const line = '<span class="onboarding-state" data-state="' + esc(i.state) + '">' + esc(LABELS[i.state] || i.state) + '</span> <span class="onboarding-text">' + esc(i.text) + "</span>" + (c ? ' <span class="onboarding-tickmark">· checked</span>' : "");
    return '<li class="onboarding-item" data-item-key="' + esc(i.key) + '" data-state="' + esc(i.state) + '"' + (c ? " data-checked" : "") + ">" +
      (body ? '<details class="onboarding-fold"><summary class="onboarding-line">' + line + '</summary><div class="onboarding-body">' + body + "</div></details>" : '<p class="onboarding-line">' + line + "</p>") + "</li>";
  }
  // report: FP.onboardingModel.build() or fromDocument(); o: { farmName, canTick, canSave, saved, message, minutes }
  function html(report, o = {}) {
    if (!report) return '<section class="space-view onboarding-view" data-view="onboarding"><h2>Onboarding checklist</h2><p>' + esc(o.message || "This farm's onboarding checklist isn't available to you.") + "</p></section>";
    const n = report.counts || {}, parts = [[n.propose, "to confirm"], [n.verify, "to check"], [n.gap, "missing"], [n.found, "found"], [n.done, "done"]].filter(([x]) => x > 0).map(([x, w]) => x + " " + w);
    const status = o.saved ? "Saved " + (when(report.saved?.at) || "") + (report.saved?.by?.name ? " by " + report.saved.by.name : "") + ", as it was then."
      : (parts.join(" · ") || "Nothing found yet") + (n.checked ? " · " + n.checked + " checked" : "");
    const sections = list(report.sections).filter((s) => list(s.items).length).map((s) => '<section class="onboarding-section" data-section="' + esc(s.key) + '"><h3>' + esc(s.title) +
      '</h3><ul class="onboarding-list">' + list(s.items).map((i) => itemHtml(i, o)).join("") + "</ul></section>").join("");
    const effort = model().effortLines(report.effort);
    const save = o.canSave && !o.saved ? '<form class="onboarding-save" data-onboarding-save><label for="ob-minutes">Minutes spent on this farm\'s onboarding by hand (optional)</label>' +
      '<input id="ob-minutes" name="minutes" type="number" inputmode="numeric" min="0" max="100000" step="1"' + (o.minutes != null ? ' value="' + esc(o.minutes) + '"' : "") + ">" +
      '<button type="submit">Save to Documents</button>' + (report.audience === "private" ? '<p class="onboarding-private">It lists a private document, so it is saved private: you and the farm\'s owner can read it.</p>' : "") + "</form>" : "";
    return '<section class="space-view onboarding-view" data-view="onboarding"><h2>Onboarding checklist</h2>' +
      '<p class="onboarding-status" role="status">' + esc(status) + (o.saved ? ' <a href="' + esc(o.liveHref || "#") + '" data-onboarding-live>See it as it is now</a>' : "") + "</p>" +
      '<p class="onboarding-intro">What the platform already holds for ' + esc(report.farm?.name || "this farm") + ", what it can propose, and what needs a person. Nothing here changes the farm's records: each proposal is confirmed where it belongs.</p>" +
      (o.message ? '<p class="onboarding-msg" role="status">' + esc(o.message) + "</p>" : "") + sections +
      '<section class="onboarding-section" data-section="effort"><h3>Effort</h3><ul class="onboarding-effort">' + effort.map((l) => "<li>" + esc(l) + "</li>").join("") + "</ul>" + save + "</section></section>";
  }

  // ---- the browser's part --------------------------------------------------------------------------------------------
  const draftKey = (user, farm) => "fp-onboarding-ticks-" + (user || "anon") + "-" + farm;
  function readDraft(user, farm) { try { const v = JSON.parse(localStorage.getItem(draftKey(user, farm)) || "{}"); return v && typeof v === "object" ? v : {}; } catch { return {}; } }
  function writeDraft(user, farm, ticks) { try { if (Object.keys(ticks).length) localStorage.setItem(draftKey(user, farm), JSON.stringify(ticks)); else localStorage.removeItem(draftKey(user, farm)); } catch {} }
  async function fetchJson(sb, path) {
    const { data, error } = await sb.storage.from("documents").createSignedUrl(path, 300);
    if (error || !data?.signedUrl) return null;
    try { const r = await fetch(data.signedUrl); return r.ok ? await r.json() : null; } catch { return null; }
  }
  // host: the element; env: { sb, farm: {id, name}, user: {id, name}, canEdit, item (a saved report's id), docs (the farm's
  // documents), store (the Documents store: add, move), onAction(kind, item), onSaved(), liveHref }
  async function mount(host, env) {
    const M = model(), farm = env.farm.id, user = env.user?.id || null;
    let inputs = null, report = null, plans = {}, saved = null, draft = readDraft(user, farm), message = null, minutes = null, started = 0;
    const draw = (o = {}) => { host.innerHTML = html(report, { canTick: !!env.canEdit || !!user, canSave: !!env.canEdit, liveHref: env.liveHref, message, minutes, ...o }); };
    const rebuild = () => { report = M.build(inputs, { now: new Date().toISOString(), plans, saved, draft, client_ms: (globalThis.performance?.now() || 0) - started }); draw(); };
    host.innerHTML = '<section class="space-view onboarding-view" data-view="onboarding"><h2>Onboarding checklist</h2><p class="onboarding-status" role="status">Reading what the platform holds for this farm…</p></section>';
    // A saved report: drawn as it was saved.
    if (env.item) {
      const doc = list(env.docs).find((d) => d.id === env.item);
      const json = doc?.storage_path ? M.readDocument(await fetchJson(env.sb, doc.storage_path)) : null;
      report = M.fromDocument(json);
      if (!report) { host.innerHTML = html(null, { message: "That onboarding report couldn't be read." }); return; }
      draw({ saved: true });
      return;
    }
    started = globalThis.performance?.now() || 0;
    const { data, error } = await env.sb.rpc("onboarding_report_inputs", { f: farm });
    if (error) { host.innerHTML = html(null, { message: "Couldn't read the farm just now: " + (error.message || error) }); return; }
    if (!data) { host.innerHTML = html(null); return; }
    inputs = data;
    // the reader files (a waiting confirm report, a read-in plan) and the last saved report, each fetched as the person
    for (const d of M.planFiles(inputs)) { const s = M.planProposals(await fetchJson(env.sb, d.storage_path)); if (s) plans[d.id] = s; }
    const last = list(inputs.documents).filter((d) => d.doc_type === "onboarding_report" && d.tier !== "archive" && d.storage_path).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
    if (last) saved = M.readDocument(await fetchJson(env.sb, last.storage_path));
    rebuild();

    host.onclick = async (e) => {
      const go = e.target.closest("[data-onboarding-action]");
      if (go) { env.onAction?.(go.dataset.onboardingAction, go.dataset.onboardingItem || null); return; }
      const t = e.target.closest("[data-onboarding-tick]");
      if (t) {
        const key = t.dataset.onboardingTick, it = report.items.find((i) => i.key === key);
        const note = host.querySelector('[data-onboarding-note="' + CSS.escape(key) + '"]')?.value?.trim() || null;
        if (!it) return;
        draft[key] = { verdict: t.dataset.verdict, note, by: user, at: new Date().toISOString(), evidence: it.evidence };
        writeDraft(user, farm, draft); message = null; rebuild();
        host.querySelector('[data-item-key="' + CSS.escape(key) + '"] summary')?.focus();
        return;
      }
      const u = e.target.closest("[data-onboarding-untick]");
      if (u) { draft[u.dataset.onboardingUntick] = { verdict: "cleared" }; writeDraft(user, farm, draft); rebuild(); }
    };
    host.onsubmit = async (e) => {
      if (!e.target.matches("[data-onboarding-save]")) return;
      e.preventDefault();
      const button = e.target.querySelector("button[type=submit]");
      const raw = e.target.querySelector("[name=minutes]")?.value;
      minutes = raw === "" || raw == null ? null : Number(raw);
      button.disabled = true;
      try {
        const now = new Date().toISOString();
        rebuild();
        const hash = root.FP?.documentsBlock?.sha256Hex ? await root.FP.documentsBlock.sha256Hex(new TextEncoder().encode(JSON.stringify(inputs))) : null;
        const text = M.documentJson(report, { person: env.user, now, inputs_hash: hash, minutes_by_hand: minutes });
        const file = new File([text], M.fileName(now), { type: "application/json" });
        await env.store.add({ file, title: M.title(now), doc_type: "onboarding_report", tier: "primary", relates_to: null, ...(report.audience === "private" ? { visibility: "private" } : {}) });
        // the previous report goes to Archive (kept, not shown first); someone else's private one stays where it is
        for (const d of list(inputs.documents).filter((x) => x.doc_type === "onboarding_report" && x.tier !== "archive")) { try { await env.store.move(d.id, { tier: "archive" }); } catch {} }
        draft = {}; writeDraft(user, farm, draft);
        message = "Saved to Documents as " + M.title(now) + (report.audience === "private" ? " (private)." : ".");
        await env.onSaved?.();
        const again = await env.sb.rpc("onboarding_report_inputs", { f: farm });
        if (!again.error && again.data) { inputs = again.data; saved = M.readDocument(text); }
        rebuild();
      } catch (err) {
        message = "Couldn't save the report: " + (err?.message || err); draw();
      }
    };
  }
  return { html, mount, LABELS, draftKey };
});
