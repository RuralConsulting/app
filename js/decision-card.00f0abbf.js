// DEC1b (#414): the decision card, one component for every queue that asks a person to decide: a group's gaps (member matches) and
// site questions and its review-due feed (group-manage.js), a farm's onboarding findings and consent matches (onboarding.js). A
// question is put with the thing it is about, open and in view, and the answer is not limited to the platform's guesses:
//   - a document: what identifies it at once (a workbook's cover fields; a PDF's or Word file's first page, folded after a few lines),
//     and, when the proposal names a document the person may read (proposals.document_id), the file itself opened beside the question
//     from a signed URL out of the owner's storage; when it names none, the identity alone and a plain line that the file isn't held here;
//   - a place: the feature framed on a small map with its neighbours (the group's own layers read for that box, never whole; #375), at
//     the moment the card is drawn; clicking the card frames it again;
//   - the answer: the platform's candidates first with their evidence; for a member match, any current member of the register found by
//     number or name (proposals_decide's chosen_from "register"); "Not this" always; a row with no candidate offers the register only.
// What was on screen (the identity shown, the file opened, the place framed) goes with the answer as `viewed` (DEC1a).
// One renderer, two sinks: `render(card, { el })` builds nodes with the host's el() (FP.el in the browser, the tests' fake DOM), and
// `html(card)` the same markup as a string (onboarding.js draws its view as HTML). The words of each queue are its own model's; the
// card's pure parts are decision-card-model.js. No AI; the only writes are the host's call to public.proposals_decide.
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else { root.FP = root.FP || {}; root.FP.decisionCard = api; }
})(typeof window === "undefined" ? globalThis : window, function (root) {
  const model = () => (typeof module === "object" && module.exports ? require("./decision-card-model.js") : root.FP.decisionCardModel);
  const list = (v) => (Array.isArray(v) ? v : []);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const text = (v) => String(v ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

  // ---- the string sink: el()'s signature, markup out (function attributes are left out: the host delegates its clicks) ------------
  const VOID = new Set(["input", "br", "img"]);
  function sel(tag, attrs = {}, ...kids) {
    const a = Object.entries(attrs || {}).filter(([k, v]) => typeof v !== "function" && v !== false && v != null && !k.startsWith("on"))
      .map(([k, v]) => " " + k + (v === true || v === "" ? (k === "value" ? '=""' : "") : '="' + esc(v) + '"')).join("");
    const inner = kids.flat(Infinity).filter((k) => k != null && k !== false).map((k) => (typeof k === "object" && "html" in k ? k.html : esc(k))).join("");
    return { html: "<" + tag + a + ">" + (VOID.has(tag) ? "" : inner + "</" + tag + ">") };
  }

  // Each host's names for the answer's parts, so its own handlers and tests read them as before: the manage space's buttons carry
  // data-act; the onboarding view's carry data-onboarding-decide with data-proposal-id, its pick and note their own attributes.
  const NS = {
    manage: { decide: "data-act", pick: "data-card-pick", note: "data-card-note", noteClass: "manage-note", msg: "manage-msg", buttons: "manage-buttons", controls: "manage-controls card-answer",
      candidate: "manage-candidate", evidence: "manage-evidence", noteMax: 2000, idAttr: false, idPrefix: "card", secondary: "secondary" },
    onboarding: { decide: "data-onboarding-decide", pick: "data-onboarding-pick", note: "data-onboarding-dnote", noteClass: null, msg: "onboarding-decide-msg", buttons: "onboarding-buttons",
      controls: "card-answer", candidate: "onboarding-candidate", evidence: "card-evidence", noteMax: 500, idAttr: true, idPrefix: "ob", secondary: null },
  };
  const nsOf = (o) => NS[o?.ns] || NS.manage;

  // ---- the thing ---------------------------------------------------------------------------------------------------------------
  // card.thing is decision-card-model.thingOf(); card.p the proposal row.
  function thingNode(card, { el }) {
    const M = model(), t = card.thing || { type: "plain" };
    if (t.type === "document") {
      // a member match always says what is held of its file (or that nothing is yet); another queue's document only when it has an identity
      const v = t.identity || card.p?.kind === "member_match_file" ? M.identityView(t.identity) : null;
      const kids = [el("h4", { class: "card-thing-title" }, v ? "What the file says" : "The document" + (t.title ? ": " + t.title : ""))];
      if (!v) { /* the file alone */ } else if (v.kind === "workbook" && v.fields.length) {
        kids.push(el("dl", { class: "card-fields" }, ...v.fields.map((f) => el("div", {}, el("dt", {}, f.label), el("dd", {}, f.value)))));
      } else if (v.kind === "document" && v.shown.length) {
        kids.push(el("div", { class: "card-page", lang: "en" }, ...v.shown.map((l) => el("p", {}, l || " "))));
        if (v.more.length) kids.push(el("details", { class: "card-more" }, el("summary", {}, "The rest of the first page (" + v.more.length + (v.more.length === 1 ? " line)" : " lines)")),
          el("div", { class: "card-page" }, ...v.more.map((l) => el("p", {}, l || " ")))));
      }
      if (v) kids.push(el("p", { class: "card-fine" }, v.text));
      if (t.documentId) {
        kids.push(el("button", { type: "button", class: "secondary card-open", "data-card-open": t.documentId }, "Open the file beside the question"),
          el("div", { class: "card-viewer", "data-card-viewer": t.documentId, hidden: "" }));
      } else if (card.p?.kind === "member_match_file") {
        kids.push(el("p", { class: "card-not-held" }, "The file itself isn't held here yet, so it can't be opened from this screen: decide from what it says above."));
      }
      return el("section", { class: "card-thing", "data-thing": "document" }, ...kids);
    }
    if (t.type === "place") {
      const v = M.identityView(t.identity);
      const facts = v.kind === "paddock" ? v.facts : [];
      if (!t.geometry) {
        return el("section", { class: "card-thing", "data-thing": "place", "data-map": "none" }, el("h4", { class: "card-thing-title" }, "Where it is"),
          el("p", { class: "card-fine" }, t.identity ? v.text || "Its shape isn't held." : "Its shape isn't held yet, so it can't be shown on the map: the next proposal run adds it."),
          facts.length ? el("p", { class: "card-fine" }, facts.join(" · ")) : null);
      }
      return el("section", { class: "card-thing", "data-thing": "place", "data-map": "pending" }, el("h4", { class: "card-thing-title" }, "Where it is"),
        el("div", { class: "card-map", "data-card-map": String(card.id), role: "img", "aria-label": "Map: the paddock asked about, outlined, with the group's paddocks and member blocks around it" }),
        el("p", { class: "card-fine card-map-note", "data-card-map-note": "" }, [facts.join(" · "), v.text].filter(Boolean).join(". ")),
        el("button", { type: "button", class: "secondary card-frame", "data-card-frame": String(card.id) }, "Frame it again"));
    }
    return null;
  }

  // ---- the candidates and their evidence (read only: a decided row, or a viewer) -------------------------------------------------------
  function evidenceNode(c, { el }, ns) {
    return list(c.evidence).length ? el("ul", { class: ns.evidence }, ...c.evidence.map((x) => el("li", {}, x))) : null;
  }
  function candidateNode(c, o, ns) {
    return el0(o)("div", { class: ns.candidate }, el0(o)("span", {}, c.label + (c.detail ? " · " + c.detail : "")), evidenceNode(c, o, ns));
  }
  const el0 = (o) => o.el;

  // ---- the answer --------------------------------------------------------------------------------------------------------------------
  // card.answer: decision-card-model.answerOf() for "member" and "choice", or { mode: "actions", actions: [{ key, label, primary }], hint }.
  // o.onDecide(action, { pick, button }) is called by the buttons (the manage space); the string sink leaves it to the host's
  // delegated handler (the onboarding view reads its pick and note by their attributes, as before).
  function answerNode(card, o) {
    const el = o.el, ns = nsOf(o), M = model(), a = card.answer || M.answerOf(card.p), id = String(card.id), p = card.p || {};
    const cands = list(card.candidates), labels = card.labels || {};
    const state = { pick: a.mode === "member" && a.preselect != null ? { from: "candidates", index: a.preselect } : null };
    const msg = el("p", { class: ns.msg, role: "status", "data-decide-msg": id });
    const say = (t) => { msg.textContent = t; };
    const idOf = (k) => (ns.idAttr ? { "data-proposal-id": id } : {});
    const buttons = [];
    const button = (key, label, primary) => {
      const b = el("button", { type: "button", ...(primary ? { class: "primary" } : ns.secondary ? { class: ns.secondary } : {}), [ns.decide]: key, ...idOf(key),
        onclick: (e) => o.onDecide?.(key, { pick: state.pick, button: e?.target || b, say, buttons, note: note.value }) }, el === sel ? { html: text(label) } : label);   // (a label's apostrophe as written)
      buttons.push(b);
      return b;
    };
    const noteId = ns.idPrefix + "-dnote-" + id;
    const note = el("input", { type: "text", maxlength: String(ns.noteMax), id: noteId, [ns.note]: id, ...(ns.noteClass ? { class: ns.noteClass } : {}), "aria-label": "Note on " + (card.title || "this decision"), placeholder: "Note (optional)" });
    const parts = [];
    if (a.mode === "actions") {
      for (const x of list(a.actions)) button(x.key, x.label, !!x.primary);
      parts.push(note, el("div", { class: ns.buttons }, ...buttons));
      if (a.hint) parts.push(el("p", { class: "onboarding-who card-hint" }, a.hint));
    } else if (a.mode === "member") {
      const name = ns.idPrefix + "-pick-" + id, radios = [];
      // the prompt ("No suggestion: pick a member") is the card's state line when it has a heading; said here only when it has none
      const prompt = a.prompt && !card.stateText ? a.prompt : null;
      if (a.noSuggestion) { if (prompt) parts.push(el("p", { class: "card-nosuggest", "data-card-nosuggest": "" }, prompt)); }
      else {
        if (prompt) parts.push(el("p", { class: "card-prompt" }, prompt));
        parts.push(el("fieldset", { class: "card-options" }, el("legend", {}, cands.length === 1 ? "The platform's suggestion" : "The platform's suggestions"),
          ...cands.map((c, i) => {
            const r = el("input", { type: "radio", name, value: String(i), [ns.pick]: id, ...(state.pick?.from === "candidates" && state.pick.index === i ? { checked: "" } : {}),
              onchange: () => { state.pick = { from: "candidates", index: i }; picked.textContent = ""; say(""); } });
            radios.push(r);
            return el("div", { class: "card-option " + ns.candidate }, el("label", {}, r, el("span", {}, c.label + (c.detail ? " · " + c.detail : ""))), evidenceNode(c, o, ns));
          })));
      }
      let picked = el("p", { class: "card-picked", role: "status", "data-card-picked": id });
      if (a.register) {
        const searchId = ns.idPrefix + "-search-" + id;
        const results = el("ul", { class: "card-results", "data-card-results": id });
        const choose = (m) => {
          state.pick = { from: "register", member: m.member, group_member_id: m.group_member_id };
          for (const r of radios) r.checked = false;
          picked.textContent = "Picked from the register: " + m.label;
          results.replaceChildren();
          say("");
        };
        const search = el("input", { type: "search", id: searchId, autocomplete: "off", spellcheck: "false", "data-card-search": id, placeholder: "Member number or name",
          oninput: (e) => {
            const q = (e?.target || search).value;
            const hits = M.searchRegister(card.register, q);
            results.replaceChildren(...hits.map((m) => el("li", {}, el("button", { type: "button", class: "card-result", "data-card-member": m.member, onclick: () => choose(m) }, m.label))));
            if (String(q || "").trim() && !hits.length) results.append(el("li", { class: "card-fine" }, "No current member matches “" + String(q).trim() + "”."));
          } });
        parts.push(el("div", { class: "card-register" }, el("label", { for: searchId }, a.noSuggestion ? "Search the register by member number or name" : "Or any member of the register, by number or name"),
          search, results, picked));
        if (card.register == null) parts.push(el("p", { class: "card-fine" }, "The register couldn't be read, so only the platform's suggestions can be picked."));
      }
      button("accept", state.pick ? labels.accept || "Accept" : labels.pick || "Accept the member picked", true);
      button("reject", labels.reject || "Not this", false);
      parts.push(note, el("div", { class: ns.buttons }, ...buttons));
    } else {
      // choice: one candidate is named and accepted as it is; several are picked from a list
      if (!a.several && cands[0]) parts.push(el("p", { class: ns.candidate }, cands[0].label));
      const pick = a.several ? el("select", { id: ns.idPrefix + "-pick-" + id, [ns.pick]: id, "aria-label": "Pick one for " + (card.title || "this decision"),
        onchange: (e) => { const v = (e?.target || pick).value; state.pick = v === "" ? null : { from: "candidates", index: Number(v) }; } },
      el("option", { value: "" }, labels.choose || "Pick one…"), ...cands.map((c, i) => el("option", { value: String(i) }, c.label))) : null;
      if (pick) parts.push(ns.idAttr ? el("label", { class: "visually-hidden", for: ns.idPrefix + "-pick-" + id }, "Pick one") : null, pick);
      if (p.status === "proposed") button("accept", labels.accept || "Accept", true);
      button("reject", labels.reject || "Not this", false);
      if (a.several) button("pick", labels.pick || "Accept the one picked", false);
      parts.push(ns.idAttr ? el("label", { class: "visually-hidden", for: noteId }, "Note") : null, note, el("div", { class: ns.buttons }, ...buttons));
    }
    parts.push(msg);
    return el("div", { class: ns.controls, "data-card-answer": a.mode }, ...parts);
  }

  // ---- the whole card ------------------------------------------------------------------------------------------------------------------
  // card: { id, p, title, what, sub, state, stateText, lines: [], thing, candidates: [{ label, detail, evidence }], shown: [indices] (the
  // candidates whose evidence a read-only card shows), answer, register (group_members rows, or null), canAnswer, decided }
  function render(card, o = {}) {
    const el = o.el, ns = nsOf(o);
    const head = card.title ? [el("div", { class: "manage-item card-head" }, el("b", {}, card.title), card.sub ? el("small", {}, card.sub) : null),
      el("p", { class: "manage-state card-state", tabindex: "-1" }, card.stateText || "")] : [];
    const lines = list(card.lines).filter(Boolean).map((t) => el("small", { class: "card-line" }, t));
    const thing = thingNode(card, o);
    const question = [];
    if (card.canAnswer) question.push(answerNode(card, o));
    else for (const i of list(card.shown)) if (card.candidates?.[i]) question.push(candidateNode(card.candidates[i], o, ns));
    if (card.decided) question.push(el("small", { class: "card-decided" }, card.decided));
    const body = el("div", { class: "card-body" + (thing ? " card-with-thing" : "") }, thing, el("div", { class: "card-question" }, ...question));
    const attrs = { class: (o.wrapClass || "decision-card"), "data-proposal": String(card.id), "data-card-kind": card.thing?.type || "plain", ...(card.state ? { "data-state": card.state } : {}), ...(o.attrs || {}) };
    return el(o.tag || "article", attrs, ...head, ...lines, body);
  }
  const html = (card, o = {}) => render(card, { ...o, el: sel }).html;

  // ---- what was on screen ----------------------------------------------------------------------------------------------------------
  // Per proposal, for this visit: the things the card showed, in viewedList's shape. The host passes seen(id) with the answer.
  const views = new Map();
  const seen = (id) => { const k = String(id); if (!views.has(k)) views.set(k, []); return views.get(k); };
  const note = (id, item) => { if (item) seen(id).push(item); };
  function forget() { views.clear(); layerReads.clear(); sweep(true); }

  // ---- the browser's part ----------------------------------------------------------------------------------------------------------
  // mount(node, card, env): after the card is on the page, records that its identity was shown, frames its place on a small map and
  // wires "Open the file". env: { sb, groupId (the group whose layers hold the neighbours), docs (rows already read, with
  // storage_path: a farm's documents) }.
  // The card maps on the page: { node, box, surface, parts, off, at (when last framed), say }. Each holds a WebGL context and the
  // engine's listeners, so a map whose card has left the page is removed (sweep), every map goes when the person leaves Manage
  // (group-space.js) or the visit is forgotten, and a map that failed to open gives its place back at once.
  const live = new Set();
  const watching = new Set();   // the visibility observers of cards not yet drawn: { box, io }
  const blobs = new Set();      // the files framed in a viewer: { url, viewer } (object URLs, revoked with their card)
  const MAX_MAPS = 6;
  const WAITING = "Press “Frame it again” to show it on the map (a few maps are open on this screen already).";
  const drop = (m) => { try { m.parts?.destroy(); m.off?.(); m.surface.remove(); } catch { /* already gone */ } live.delete(m); };
  let epoch = 0;                // counts the full sweeps: a file still being fetched when its screen was left is not framed afterwards
  function sweep(all = false) {
    if (all) epoch++;
    for (const m of [...live]) if (all || !m.box.isConnected) drop(m);
    for (const w of [...watching]) if (all || !w.box.isConnected) { try { w.io?.disconnect(); } catch { /* gone */ } w.stop = true; watching.delete(w); }
    for (const b of [...blobs]) if (all || !b.viewer?.isConnected) { try { root.URL?.revokeObjectURL?.(b.url); } catch { /* gone */ } blobs.delete(b); }
  }
  function mount(node, card, env = {}) {
    const M = model(), t = card.thing || {};
    if (!node || typeof node.querySelector !== "function") return;
    if ((t.type === "document" && t.identity && !M.identityView(t.identity).empty) || (t.type === "place" && t.identity)) note(card.id, M.seenIdentity(t));
    const open = node.querySelector("[data-card-open]");
    if (open) open.addEventListener("click", () => openDocument(node, card, env, open));
    if (t.type === "place" && t.geometry) {
      const box = node.querySelector("[data-card-map]");
      // a press of "Frame it again" (or a click on the card) frames the place again; with no map yet it draws one, making room if it must
      const frame = () => {
        const m = [...live].find((x) => x.box === box);
        if (!m) return drawMap(node, box, card, env, { asked: true });
        m.surface.frame(t.geometry); m.at = Date.now();
        note(card.id, M.seenFeature(t, m.surface.camera?.()));
        return Promise.resolve();
      };
      node.querySelector("[data-card-frame]")?.addEventListener("click", frame);
      // clicking the card (anywhere but its controls and its links) frames the place again
      node.addEventListener("click", (e) => { if (!e.target.closest?.("button, input, select, textarea, a, summary, label, .card-answer, .card-map")) frame(); });
      // drawn once the card is on the page and near the screen (a long queue does not open a map for every card at once)
      if (box && typeof root.maplibregl !== "undefined" && root.FP?.mapScene) whenShown(box, () => drawMap(node, box, card, env));
      else if (box) drawMap(node, box, card, env);   // says the map isn't available
    }
  }
  function whenShown(box, fn) {
    const w = { box, io: null, stop: false };
    watching.add(w);
    const go = () => { watching.delete(w); fn(); };
    if (typeof root.IntersectionObserver === "function") {
      w.io = new root.IntersectionObserver((seen) => { if (!w.stop && seen.some((e) => e.isIntersecting)) { w.io.disconnect(); go(); } }, { rootMargin: "300px" });
      w.io.observe(box);
      return;
    }
    let tries = 0;
    const tick = () => { if (w.stop) return; if (box.isConnected) go(); else if (tries++ < 100) setTimeout(tick, 50); else watching.delete(w); };
    tick();
  }
  const EMPTY = { type: "FeatureCollection", features: [] };
  // The group's own layers (map_layers, readable by its members: their names and themes, no shapes), read once per group for this
  // visit, and only when a card frames a place. A refused read draws the place without neighbours.
  const layerReads = new Map();
  function layersOf(env) {
    if (!env.sb || !env.groupId) return Promise.resolve([]);
    if (!layerReads.has(env.groupId)) layerReads.set(env.groupId, Promise.resolve(env.sb.from("map_layers").select("id,name,theme,geometry_type,source_file,source,style").eq("org_id", env.groupId))
      .then((r) => (r?.error ? [] : list(r?.data)), () => []));
    return layerReads.get(env.groupId);
  }
  // The group's own layers that hold the neighbours: paddocks and member blocks, and the layer the held paddock came from (by its
  // file), polygons only, at most four. Each is read for the paddock's box alone (group_layer_features, bounded; never whole).
  function neighbourLayers(rows, t) {
    const want = (l) => l && l.id && l.geometry_type === "polygon" && (["paddocks", "member_blocks"].includes(l.theme) || (t.layerFile && l.source_file && String(l.source_file).split("/").pop() === t.layerFile));
    return list(rows).filter(want).slice(0, 4).map((l) => ({ id: l.id, name: l.name, theme: l.theme, geometry_type: "polygon", group_own: true, style: l.style || {}, source: l.source || "the group's own map",
      deferred: true, feature_count: null, features: EMPTY }));
  }
  // With MAX_MAPS open and the person asking for another: the map framed longest ago gives way (one off the screen first). Its card
  // goes back to waiting, and its own "Frame it again" brings it back the same way.
  function evict() {
    const off = (m) => { try { const r = m.box.getBoundingClientRect?.(); return !!r && (r.bottom < 0 || r.top > (root.innerHeight || 0)); } catch { return false; } };
    const pool = [...live].sort((a, b) => a.at - b.at), oldest = pool.find(off) || pool[0];
    if (!oldest) return;
    drop(oldest);
    oldest.say?.("waiting", WAITING);
  }
  async function drawMap(node, box, card, env, { asked = false } = {}) {
    const M = model(), t = card.thing, thing = node.querySelector('[data-thing="place"]'), noteLine = node.querySelector("[data-card-map-note]");
    const say = (s, text) => { if (thing) thing.dataset.map = s; if (text && noteLine) noteLine.textContent = text; };
    if (!box || typeof root.maplibregl === "undefined" || !root.FP?.mapScene) { say("unavailable", "The map isn't available in this browser. " + (noteLine?.textContent || "")); return; }
    sweep();
    if ([...live].some((m) => m.box === box)) return;
    if (live.size >= MAX_MAPS) {
      if (!asked) { say("waiting", WAITING); return; }
      evict();
    }
    const entry = { node, box, surface: root.FP.mapScene.engine(box), parts: null, off: null, at: Date.now(), say };
    live.add(entry);
    const gone = () => !live.has(entry);
    let rows = [];
    try { rows = list(await layersOf(env)); } catch { rows = []; }
    if (gone()) return;
    if (!box.isConnected) { drop(entry); return; }
    const layers = neighbourLayers(rows, t);
    const scene = { farm: { id: null, name: t.layerFile || "The paddock" }, extent: t.geometry, extent_label: "The paddock asked about", extent_ha: t.identity?.areaHa ?? null,
      titles: EMPTY, land_units: EMPTY, layers, reference: [] };
    let view = null;
    try { view = await entry.surface.open(null, scene, { show: ["extent", ...layers.map((l) => l.theme)] }); } catch { view = null; }
    if (gone()) return;
    // a map that did not open gives its place back at once (its WebGL context with it)
    if (!view || !box.isConnected) { drop(entry); if (!view) say("failed", "The map couldn't be drawn just now."); return; }
    entry.surface.frame(t.geometry); entry.at = Date.now();
    note(card.id, M.seenFeature(t, entry.surface.camera?.()));
    say("drawn");
    if (!layers.length || !root.FP.groupLayers || !env.sb || !env.groupId) return;
    const entries = list(view.entries);
    entry.parts = root.FP.groupLayers.create({ sb: env.sb, group: env.groupId, layers, max: 1500,
      onData: (id, features) => { for (const e of entries) if (e.deferred && String(e.layerId) === String(id)) entry.surface.layerData(e, features); } });
    // the paddock's box with a margin about its own size (at least about 300 m): the neighbours, never the whole layer
    const [w, s, e, n] = t.bbox, mx = Math.max((e - w) * 0.75, 0.004), my = Math.max((n - s) * 0.75, 0.003);
    const frame = { bounds: [[w - mx, s - my], [e + mx, n + my]], zoom: 15 };
    await Promise.all(layers.map((l) => entry.parts.show(l.id, frame)));
    if (gone()) return;
    entry.off = entry.surface.onMoveEnd?.(() => entry.parts?.moved(entry.surface.view())) || null;
  }
  // The kinds of file framed beside the question, by their stored name, and the type they are framed as. Anything else (a workbook,
  // a Word file, and never a page or an SVG from client storage, which could script or navigate the app) opens in a new tab.
  const FRAMED = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", txt: "text/plain" };
  const frameType = (path) => FRAMED[(/\.([a-z0-9]+)$/i.exec(String(path || "")) || [])[1]?.toLowerCase()] || null;
  // DEC2: the most a file may be to be fetched and framed: 50 MB, by the stored size (documents.size_bytes) when it is known before
  // fetching, else by the response's Content-Length, else (neither given) by what was read. The fetch reads the whole file into
  // memory to make its object URL, so above the cap nothing is fetched: the card says why and offers the new-tab link, where the
  // browser's own viewer streams it.
  const MAX_FRAME_BYTES = 50 * 1024 * 1024;
  const bytesOf = (v) => { const n = typeof v === "string" && v.trim() === "" ? NaN : Number(v); return Number.isFinite(n) && n >= 0 ? n : null; };
  const sizeText = (n) => (n >= 1024 * 1024 * 1024 ? (n / 1024 / 1024 / 1024).toFixed(1) + " GB" : Math.max(1, Math.round(n / 1024 / 1024)) + " MB");
  // The file itself, beside the question: the document row the person may read (row-level security decides), signed from the owner's
  // storage for an hour. A kind the browser draws is fetched (the app's connect-src allows the storage origin) and framed as an object
  // URL of its own type (the app's child-src allows blob:, never the storage origin); any other kind opens in a new tab.
  async function openDocument(node, card, env, button) {
    const M = model(), t = card.thing, viewer = node.querySelector("[data-card-viewer]"), el = root.FP.el;
    sweep();   // DEC2: a file opened earlier on a screen that has been redrawn (the onboarding view) gives its object URL back first
    const born = epoch;
    const failed = (text) => { if (viewer) { viewer.hidden = false; viewer.replaceChildren(el("p", { role: "alert" }, text)); } };
    button.disabled = true;
    const was = button.textContent;
    button.textContent = "Opening…";
    const done = () => { button.disabled = false; button.textContent = was; };
    let doc = list(env.docs).find((d) => String(d.id) === String(t.documentId)) || null;
    if (!doc?.storage_path && env.sb) {
      try { const { data } = await env.sb.from("documents").select("id,title,storage_path,size_bytes").eq("id", t.documentId); doc = list(data)[0] || null; } catch { doc = null; }
    }
    const signed = doc?.storage_path && env.sb ? await Promise.resolve(env.sb.storage.from("documents").createSignedUrl(doc.storage_path, 3600)).catch(() => ({ error: true })) : { error: true };
    if (signed?.error || !signed?.data?.signedUrl) { done(); failed("Couldn't open the file: it may not be yours to read, or it is no longer held."); return; }
    const url = signed.data.signedUrl, title = doc.title || t.title || "the file", type = frameType(doc.storage_path);
    let framed = null, tooBig = null;
    const stored = bytesOf(doc.size_bytes);
    if (type && viewer && stored != null && stored > MAX_FRAME_BYTES) tooBig = stored;   // known before fetching: nothing is fetched
    else if (type && viewer) {
      try {
        const r = await root.fetch(url);
        if (!r.ok) throw new Error("HTTP " + r.status);
        const told = bytesOf(r.headers?.get?.("content-length"));
        if (told != null && told > MAX_FRAME_BYTES) { tooBig = told; try { r.body?.cancel?.(); } catch { /* nothing to stop */ } }
        else {
          const blob = await r.blob();
          if (blob.size > MAX_FRAME_BYTES) tooBig = blob.size;   // no size given anywhere: judged by what was read
          else framed = root.URL.createObjectURL(new root.Blob([blob], { type }));
        }
      } catch { framed = null; }
    }
    // the screen was left (or redrawn from top) while the file was coming: its object URL is not kept
    if (framed && (epoch !== born || !viewer?.isConnected)) { try { root.URL.revokeObjectURL(framed); } catch { /* gone */ } framed = null; }
    done();
    if (viewer) {
      for (const b of [...blobs]) if (b.viewer === viewer) { try { root.URL.revokeObjectURL(b.url); } catch { /* gone */ } blobs.delete(b); }
      if (framed) blobs.add({ url: framed, viewer });
      viewer.hidden = false;
      viewer.replaceChildren(...(framed ? [el("iframe", { class: "card-viewer-frame", src: framed, title: "The file: " + title })] : []),
        el("p", { class: "card-fine" }, framed ? "" : tooBig != null ? "This file is " + sizeText(tooBig) + ", too large to show beside the question (the limit is " + sizeText(MAX_FRAME_BYTES) + "). " : type ? "It couldn't be shown here. " : "This kind of file opens in a new tab. ", el("a", { href: url, target: "_blank", rel: "noopener" }, "Open " + title + " in a new tab")));
      node.querySelector(".card-body")?.classList?.add("card-viewing");
    }
    if (!type) root.open?.(url, "_blank", "noopener");
    note(card.id, M.seenDocument(t));
  }

  // A host that draws cards as HTML (onboarding.js) delegates the click on "Open the file" here: the button names the document, its
  // card names the proposal.
  function openFrom(button, env = {}) {
    const node = button?.closest?.("[data-proposal]");
    if (!node) return null;
    const id = button.dataset.cardOpen, doc = list(env.docs).find((d) => String(d.id) === String(id));
    return openDocument(node, { id: node.dataset.proposal, thing: { type: "document", documentId: id, title: doc?.title || null } }, env, button);
  }

  return { NS, render, html, thingNode, answerNode, mount, openFrom, openDocument, seen, note, forget, sweep, neighbourLayers, frameType, MAX_FRAME_BYTES, sel, MAX_MAPS, live: () => live.size };
});
