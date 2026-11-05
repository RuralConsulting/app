// ON1 — the Onboarding view: the guided checklist of the onboarding readiness report (docs/ONBOARDING-REPORT.md). It reads
// public.onboarding_report_inputs as the person (row-level security decides), applies the rules in FP.onboardingModel, and
// draws the report. A farm editor records the minutes they spent and saves the report to the farm's Documents (doc_type
// onboarding_report, private when it lists a private document). A saved report opens here as it was saved.
// ON3d: the "to confirm" lines are proposals a farm editor decides here, with Accept / Not this / Pick (and a note), through
// public.proposals_decide; a farm editor's visit first has public.farm_onboarding_sync bring the farm's rows into line with
// its findings. Viewers read them. FU3b: the "to check" and "missing" lines too, with "Seen, correct" (accept) and "Not the
// farm's" (set aside); "to follow up" is leaving the line open. Ticks on these lines used to be kept in this browser (and in a
// saved report): the person's own still valid are made decisions once, best-effort, then nothing is written to the browser.
// Nothing else is written: each proposal is carried out in the flow that owns it (Add a block, What's due's Fetch conditions, an
// advisor's plan read-in and consent register, Documents). No AI.
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
  const OPEN_FOR_DECISION = ["proposed", "ambiguous"];
  // FU3b: no line is ticked in the browser any more; "to confirm" (ON3d), "to check" and "missing" lines are decided as proposals.
  // An acknowledged line's two answers say what a tick said.
  const ACK_WORDS = { accepted: "Seen, correct", rejected: "Not the farm's" };
  const isAck = (p) => list(p?.candidates).length === 1 && p.candidates[0]?.action === "acknowledge";

  function sourceText(s) {
    if (!s) return null;
    if (s.kind === "document") return "From " + s.title + (s.date ? ", " + s.date : "");
    if (s.kind === "reference") return [s.name, s.licence, s.as_at ? "as at " + s.as_at : null].filter(Boolean).join(" · ");
    if (s.kind === "function") return "Worked out by the platform (" + s.name + ")";
    return null;
  }
  // ON3d: a "to confirm" line's proposal: what accepting it would mean, the three buttons for a farm editor (read-only for anyone else),
  // and, once decided, who decided what and when.
  function decisionHtml(i, o) {
    const p = i.proposal;
    if (!p) {
      // FU3b: a finding with no row to decide, for an editor whose rows were read: a private document, or past the first 50 of its kind
      return i.unlisted && o.canDecide && !o.saved && o.listed !== false ? '<p class="onboarding-who" data-unlisted>No decision to make here: it rests on a private document, or more than ' +
        model().CHECK_CAP + " lines of this kind are open and only the first " + model().CHECK_CAP + " are listed for a decision.</p>" : "";
    }
    const cands = list(p.candidates), id = esc(p.id), ack = isAck(p);
    const first = cands[0] && !ack ? '<p class="onboarding-candidate">' + esc(model().candidateText(cands[0])) + "</p>" : "";
    if (p.status === "accepted" || p.status === "rejected") {
      const c = i.checked || {}, by = c.by && o.userId && c.by === o.userId ? "you" : "a farm editor";
      const picked = p.status === "accepted" && p.decision?.candidate ? model().candidateText(p.decision.candidate) : null;
      return '<div class="onboarding-decision" data-proposal="' + id + '" data-status="' + esc(p.status) + '"><p class="onboarding-checked">' +
        (ack ? ACK_WORDS[p.status] : p.status === "accepted" ? "Accepted" + (picked ? ": " + esc(picked) : "") : "Not this: set aside") + (c.note ? " · " + esc(c.note) : "") +
        " · by " + by + (when(p.decided_at) ? ", " + esc(when(p.decided_at)) : "") + "</p>" +
        (ack ? '<p class="onboarding-who">Decided for as long as what it rests on is unchanged; if that changes, it is asked again.</p>'
          : p.status === "accepted" ? '<p class="onboarding-who">It is carried out where it belongs; this line closes by itself once it is done.</p>' : "") + "</div>";
    }
    if (!o.canDecide) return '<div class="onboarding-decision" data-proposal="' + id + '" data-status="' + esc(p.status) + '">' + first +
      '<p class="onboarding-who">Waiting for a farm editor to decide.</p></div>';
    if (ack) return '<div class="onboarding-decision" data-proposal="' + id + '" data-status="' + esc(p.status) + '">' +
      '<label class="visually-hidden" for="ob-dnote-' + id + '">Note</label><input type="text" maxlength="500" id="ob-dnote-' + id + '" data-onboarding-dnote="' + id + '" placeholder="Note (optional)">' +
      '<div class="onboarding-buttons"><button type="button" class="primary" data-onboarding-decide="accept" data-proposal-id="' + id + '">Seen, correct</button>' +
      '<button type="button" data-onboarding-decide="reject" data-proposal-id="' + id + '">Not the farm\'s</button></div>' +
      '<p class="onboarding-who">To follow it up later, leave it undecided: it stays open.</p>' +
      '<p class="onboarding-decide-msg" role="status" data-decide-msg="' + id + '"></p></div>';
    const several = cands.length > 1;
    const pick = several ? '<label class="visually-hidden" for="ob-pick-' + id + '">Pick one</label><select id="ob-pick-' + id + '" data-onboarding-pick="' + id + '"><option value="">Pick one…</option>' +
      cands.map((c, n) => '<option value="' + n + '">' + esc(model().candidateText(c)) + "</option>").join("") + "</select>" : "";
    return '<div class="onboarding-decision" data-proposal="' + id + '" data-status="' + esc(p.status) + '">' + (several ? "" : first) + pick +
      '<label class="visually-hidden" for="ob-dnote-' + id + '">Note</label><input type="text" maxlength="500" id="ob-dnote-' + id + '" data-onboarding-dnote="' + id + '" placeholder="Note (optional)">' +
      '<div class="onboarding-buttons">' + (p.status === "proposed" ? '<button type="button" class="primary" data-onboarding-decide="accept" data-proposal-id="' + id + '">Accept</button>' : "") +
      '<button type="button" data-onboarding-decide="reject" data-proposal-id="' + id + '">Not this</button>' +
      (several ? '<button type="button" data-onboarding-decide="pick" data-proposal-id="' + id + '">Accept the one picked</button>' : "") + "</div>" +
      '<p class="onboarding-decide-msg" role="status" data-decide-msg="' + id + '"></p></div>';
  }
  function itemHtml(i, o) {
    const sources = [i.source, ...list(i.sources)].filter(Boolean).map(sourceText).filter(Boolean);
    const props = i.proposals ? '<p class="onboarding-sub">' + (i.proposals.kind === "confirm_report" ? "Proposed values (an advisor accepts each)" : "Values read from the plan") + '</p><ul class="onboarding-values">' +
      list(i.proposals.values).map((v) => "<li><span>" + esc(v.label) + "</span> <b>" + esc(v.value) + "</b>" + (v.accepted === true ? " · accepted" : v.accepted === false ? " · not yet accepted" : "") + "</li>").join("") +
      (i.proposals.total > list(i.proposals.values).length ? "<li>and " + (i.proposals.total - list(i.proposals.values).length) + " more</li>" : "") + "</ul>" : "";
    const action = i.action && !o.saved ? (i.action.kind === "advisor" ? '<p class="onboarding-who">For an advisor to do.</p>' :
      '<p><button type="button" class="onboarding-go" data-onboarding-action="' + esc(i.action.kind) + '"' + (i.action.item ? ' data-onboarding-item="' + esc(i.action.item) + '"' : "") + ">" + esc(i.action.label) + "</button></p>") : "";
    const c = i.checked;
    const checked = c && i.proposal ? "" : c ? '<p class="onboarding-checked">Checked: ' + esc(VERDICT_WORDS[c.verdict] || c.verdict) + (c.note ? " · " + esc(c.note) : "") + (when(c.at) ? " · " + esc(when(c.at)) : "") + "</p>" : "";
    const stale = i.stale_tick ? '<p class="onboarding-stale">Ticked before (' + esc(VERDICT_WORDS[i.stale_tick.verdict] || "") + "), but what it rests on has changed since: look again.</p>" : "";
    const body = (i.detail ? '<p class="onboarding-detail">' + esc(i.detail) + "</p>" : "") + props + sources.map((s) => '<p class="onboarding-source">' + esc(s) + "</p>").join("") + stale + checked + decisionHtml(i, o) + action;
    const mark = c ? (c.decided ? (isAck(i.proposal) ? (c.verdict === "correct" ? "seen, correct" : "not the farm's") : c.verdict === "correct" ? "accepted" : "set aside") : "checked") : null;
    const line = '<span class="onboarding-state" data-state="' + esc(i.state) + '">' + esc(LABELS[i.state] || i.state) + '</span> <span class="onboarding-text">' + esc(i.text) + "</span>" + (mark ? ' <span class="onboarding-tickmark">· ' + esc(mark) + "</span>" : i.proposal && OPEN_FOR_DECISION.includes(i.proposal.status) && o.canDecide ? ' <span class="onboarding-tickmark">· to decide</span>' : "");
    return '<li class="onboarding-item" data-item-key="' + esc(i.key) + '" data-state="' + esc(i.state) + '"' + (c ? " data-checked" : "") + ">" +
      (body ? '<details class="onboarding-fold"' + (o.open === i.key ? " open" : "") + '><summary class="onboarding-line">' + line + '</summary><div class="onboarding-body">' + body + "</div></details>" : '<p class="onboarding-line">' + line + "</p>") + "</li>";
  }
  // report: FP.onboardingModel.build() or fromDocument(); o: { farmName, canDecide, userId, listed (false: the farm's rows could not be brought up), open (an item key to leave open), canSave, saved, message, minutes }
  function html(report, o = {}) {
    if (!report) return '<section class="space-view onboarding-view" data-view="onboarding"><h2>Onboarding checklist</h2><p>' + esc(o.message || "This farm's onboarding checklist isn't available to you.") + "</p></section>";
    const n = report.counts || {}, parts = [[n.propose, "to confirm"], [n.verify, "to check"], [n.gap, "missing"], [n.found, "found"], [n.done, "done"]].filter(([x]) => x > 0).map(([x, w]) => x + " " + w);
    const status = o.saved ? "Saved " + (when(report.saved?.at) || "") + (report.saved?.by?.name ? " by " + report.saved.by.name : "") + ", as it was then."
      : (parts.join(" · ") || "Nothing found yet") + (n.checked ? " · " + n.checked + " checked or decided" : "");
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
  const PROPOSAL_COLUMNS = "id,kind,subject,subject_key,candidates,status,decision,decided_by,decided_at,created_at";
  function readDraft(user, farm) { try { const v = JSON.parse(localStorage.getItem(draftKey(user, farm)) || "{}"); return v && typeof v === "object" ? v : {}; } catch { return {}; } }
  function writeDraft(user, farm, ticks) { try { if (Object.keys(ticks).length) localStorage.setItem(draftKey(user, farm), JSON.stringify(ticks)); else localStorage.removeItem(draftKey(user, farm)); } catch {} }
  async function fetchJson(sb, path) {
    const { data, error } = await sb.storage.from("documents").createSignedUrl(path, 300);
    if (error || !data?.signedUrl) return null;
    try { const r = await fetch(data.signedUrl); return r.ok ? await r.json() : null; } catch { return null; }
  }
  // ON3d: the farm's rows after a farm editor's visit has brought them into line with the findings (public.farm_onboarding_sync, the
  // database's own evaluation: nothing is sent but the farm). The live rows and the newest rejection of each finding are read as the
  // person (a farm member reads them all). { rows, problem }: rows is null when they could not be read.
  async function readProposals(env, farm) {
    let problem = null;
    if (env.canEdit) {
      try { const r = await env.sb.rpc("farm_onboarding_sync", { f: farm }); if (r?.error) problem = r.error.message || String(r.error); } catch (e) { problem = e?.message || String(e); }
    }
    try {
      const { data, error } = await env.sb.from("proposals").select(PROPOSAL_COLUMNS).eq("farm_id", farm).eq("kind", model().FARM_CHECK_KIND)
        .in("status", ["proposed", "ambiguous", "accepted", "rejected"]).order("id", { ascending: true });
      if (error) throw error;
      return { rows: list(data), problem };
    } catch (e) { return { rows: null, problem: problem || e?.message || String(e) }; }
  }
  // FU4: the farm's open "Read this plan in" requests (public.plan_import_requests), the advisor's queue: who asked and when. Optional: a database
  // without the table, or a refused read, leaves the lines as they were.
  async function readRequests(env, farm) {
    try {
      const { data, error } = await env.sb.from("plan_import_requests").select("id,document_id,requested_by,requested_by_name,requested_at,status").eq("farm_id", farm).eq("status", "requested");
      return error ? [] : list(data);
    } catch { return []; }
  }
  // host: the element; env: { sb, farm: {id, name}, user: {id, name}, canEdit, item (a saved report's id), docs (the farm's
  // documents), store (the Documents store: add, move), onAction(kind, item), onSaved(), liveHref }
  async function mount(host, env) {
    const M = model(), farm = env.farm.id, user = env.user?.id || null;
    let inputs = null, report = null, plans = {}, saved = null, draft = readDraft(user, farm), message = null, minutes = null, started = 0, proposals = null, requests = [], listed = true;
    const draw = (o = {}) => { host.innerHTML = html(report, { canDecide: !!env.canEdit, userId: user, canSave: !!env.canEdit, liveHref: env.liveHref, listed, message, minutes, ...o }); };
    const rebuild = (o) => { report = M.build(inputs, { now: new Date().toISOString(), plans, saved, draft, proposals, requests, client_ms: (globalThis.performance?.now() || 0) - started }); draw(o); };
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
    const read = await readProposals(env, farm);
    proposals = read.rows;
    requests = await readRequests(env, farm);
    // the writer or the read failed: the lines with no row may simply not be written yet, so none says it is unlisted
    if (read.problem) { listed = false; message = "Couldn't bring up what is waiting for your decision: " + read.problem; }
    rebuild();
    await migrateLocalTicks();

    // ON3d, FU3b: ticks kept in this browser (and the person's own in the last saved report) on finding lines before decisions lived in
    // the table become those decisions, once and best-effort (an editor only; a refusal or a network drop leaves a browser tick for a
    // later visit, and a saved one is still in the saved report), and nothing about these lines is written to the browser any more.
    async function migrateLocalTicks() {
      try {
        // the rows are not known (the writer or the read failed: a timeout, a second tab, a dropped network): decide nothing and keep
        // every tick, so a later normal visit moves them
        if (!proposals || read.problem) return;
        const carried = saved?.audience === "private" && report.audience !== "private" ? null : saved?.ticks;   // as build() carries them
        const { migrate, keep } = M.localTicksToMigrate(report, draft, { saved: carried, user });
        if (!migrate.length && Object.keys(keep).length === Object.keys(draft).length) return;   // nothing of these lines to move or drop
        let moved = 0;
        const left = new Set(migrate.map((m) => m.key));
        if (env.canEdit && proposals) {
          for (const m of migrate) {
            try {
              const { data: row, error } = await env.sb.rpc("proposals_decide", { id: m.proposal.id, status: m.action === "accept" ? "accepted" : "rejected", candidate: m.action === "accept" ? list(m.proposal.candidates)[0] || null : null, note: m.note || null });
              if (error || !row) continue;
              proposals = proposals.map((p) => (p.id === row.id ? row : p)); left.delete(m.key); moved++;
            } catch {}
          }
        } else for (const m of migrate) left.delete(m.key);   // a viewer cannot decide: nothing to move
        // what could not be moved yet stays stored (one more visit may); the rest of these lines' ticks are dropped
        const rest = { ...keep };
        for (const m of migrate) if (left.has(m.key) && m.from === "browser") rest[m.key] = draft[m.key];
        draft = rest; writeDraft(user, farm, draft);
        if (moved) { message = moved === 1 ? "One check you had ticked in this browser or a saved report is now a decision on the farm's record." : moved + " checks you had ticked in this browser or a saved report are now decisions on the farm's record."; rebuild(); }
      } catch {}
    }

    host.onclick = async (e) => {
      const go = e.target.closest("[data-onboarding-action]");
      if (go) { env.onAction?.(go.dataset.onboardingAction, go.dataset.onboardingItem || null); return; }
      const dec = e.target.closest("[data-onboarding-decide]");
      if (dec) await decide(dec);
    };
    async function decide(button) {
      const id = button.dataset.proposalId, item = report.items.find((i) => i.proposal && String(i.proposal.id) === String(id));
      if (!item || !env.canEdit) return;
      const box = button.closest("[data-proposal]"), msg = box?.querySelector("[data-decide-msg]");
      const say = (t) => { if (msg) msg.textContent = t; };
      const args = M.decisionArgs(item.proposal, button.dataset.onboardingDecide, { pick: box?.querySelector("[data-onboarding-pick]")?.value ?? null,
        note: box?.querySelector("[data-onboarding-dnote]")?.value });
      if (!args) { say("Pick one first."); box?.querySelector("[data-onboarding-pick]")?.focus(); return; }
      for (const b of box.querySelectorAll("button")) b.disabled = true;
      say("Saving…");
      let row = null, failure = null;
      try { const r = await env.sb.rpc("proposals_decide", args); row = r?.data || null; failure = r?.error ? (r.error.message || String(r.error)) : row ? null : "no reply"; } catch (err) { failure = err?.message || String(err); }
      if (!row) { for (const b of box.querySelectorAll("button")) b.disabled = false; say("Couldn't save the decision: " + failure); return; }
      proposals = (proposals || []).map((p) => (p.id === row.id ? row : p));
      message = null; rebuild({ open: item.key });
      host.querySelector('[data-item-key="' + CSS.escape(item.key) + '"] summary')?.focus();
    }
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
        const documentId = await env.store.add({ file, title: M.title(now), doc_type: "onboarding_report", tier: "primary", relates_to: null, ...(report.audience === "private" ? { visibility: "private" } : {}) });
        // MC3: the same effort numbers as a row RCL staff can total (the database cannot open a file). The report is saved either
        // way: if this row is refused or the network drops, the report still holds the numbers.
        try {
          const row = M.effortRecord(JSON.parse(text).effort);
          if (row && documentId && user) await env.sb.from("onboarding_effort_records").insert({ farm_id: farm, document_id: documentId, saved_by: user, ...row });
        } catch {}
        // the previous report goes to Archive (kept, not shown first); someone else's private one stays where it is
        for (const d of list(inputs.documents).filter((x) => x.doc_type === "onboarding_report" && x.tier !== "archive")) { try { await env.store.move(d.id, { tier: "archive" }); } catch {} }
        // FU3b: the browser holds only ticks still waiting to become decisions (their line has no row yet); a save keeps them
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
