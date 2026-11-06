// Layer looks (LK2, #416 slice 2): the staff page where a proposed look is judged and decided. Route #/ops/looks, RCL staff only
// (main.js routes anyone else to their farms; the page says so too). For one look at a time: what it is for, two pictures of
// the same place (Today, as every map draws it now, and Proposed, the look through the Map scene's preview, the only place a
// proposed look ever draws), at group scale on a catchment group or at paddock scale on a farm, the record's fields, and the
// two decisions: Accept (public.layer_style_accept) or Send back with a note (public.layer_style_send_back). Both pass the
// version the page drew the look at, so a look that changed since is refused (and drawn again as it is now). The looks it
// lists are the shared ones (a theme's default or a reference source's), which staff decide (PM ruling, 7 Nov 2026); a group's
// own layers' looks are its admins' and advisors', a farm's its editors'. The rules are js/looks-model.js.
(function () {
  const K = FP.looksModel, { $ } = FP;
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const MAP_TIMEOUT_MS = 25000;
  let token = 0, data = null, chosen = null, scale = "group", owners = { group: null, farm: null }, pictures = null, bases = new Map(), drawing = 0, confirming = false;

  async function read(query) { const { data: rows, error } = await query; if (error) throw error; return rows; }
  const optional = (query) => Promise.resolve(query).then((r) => (r.error ? [] : r.data || []), () => []);
  // Every list read is bounded (review-451 follow-up 6): the shared looks open or in force (never the superseded history), the
  // sources, the person's groups and farms, at most MAX_ROWS each.
  const MAX_ROWS = 200;
  const sharedLooks = async () => {
    const [open, inForce] = await Promise.all([
      read(FP.sb.from("layer_styles").select("*").is("layer_id", null).eq("status", "proposed").order("updated_at").limit(MAX_ROWS)),
      read(FP.sb.from("layer_styles").select("*").is("layer_id", null).eq("status", "reviewed").is("superseded_at", null).order("reviewed_at").limit(MAX_ROWS)),
    ]);
    return [...(open || []), ...(inForce || [])];
  };
  const withTimeout = (promise, ms) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("the map took too long")), ms);
    Promise.resolve(promise).then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
  // A picture's reference entry: the group's or the farm's context of one source (the demo's invented ones in the demo).
  const contextOf = (owner, key) => (FP.demo?.active ? FP.sb.rpc("demo_looks_reference", { scope: owner.kind, source: key })
    : owner.kind === "group" ? FP.sb.rpc("group_reference_context", { g: owner.id, source: key }) : FP.sb.rpc("farm_reference_context", { f: owner.id, source: key }));

  function shell() {
    const rows = K.rows(data.styles, data.sources), openN = rows.filter((x) => x.open).length;
    const opt = (v, label, on) => '<option value="' + esc(v) + '"' + (on ? " selected" : "") + ">" + esc(label) + "</option>";
    return '<section class="answer-panel answer-compact ops-panel" data-ops="looks"><h2>Looks to decide</h2>' +
      '<p class="answer-sentence" id="lk-summary">' + esc(rows.length ? openN + " of " + rows.length + " looks waiting for a decision — each is shown as today's map and as it would be." : "No looks to decide.") + "</p>" +
      '<p class="ops-line">A look you accept is how that layer is drawn on every farm\'s and group\'s map that shows it. Until then it is drawn only here. Send a look back with a note to say what to change.</p>' +
      '<div class="ln-controls lk-controls">' +
      '<label><span>Look</span><select id="lk-look">' + rows.map((x) => opt(x.id, x.name + " · " + x.standing, x.id === chosen?.id)).join("") + "</select></label>" +
      '<label><span>Scale</span><select id="lk-scale">' + opt("group", "Group scale", scale === "group") + opt("paddock", "Paddock scale", scale === "paddock") + "</select></label>" +
      '<label><span>Group</span><select id="lk-group">' + (data.groups.length ? data.groups.map((g) => opt(g.id, g.name, g.id === owners.group)).join("") : opt("", "No catchment group", true)) + "</select></label>" +
      '<label><span>Farm</span><select id="lk-farm">' + (data.farms.length ? data.farms.map((f) => opt(f.id, f.name, f.id === owners.farm)).join("") : opt("", "No farm", true)) + "</select></label>" +
      "</div></section>" +
      '<section class="answer-panel answer-compact ops-panel" data-ops="look" id="lk-panel" aria-live="polite">' +
      '<h3 id="lk-name"></h3><p class="answer-sentence" id="lk-purpose"></p>' +
      '<div class="lk-pair">' +
      '<figure class="lk-pic" data-pic="before"><figcaption><b>Today</b> <span class="ops-line" id="lk-where-before"></span></figcaption><div class="lk-map" id="lk-before"></div><p class="ops-line lk-caption" id="lk-caption-before"></p></figure>' +
      '<figure class="lk-pic" data-pic="after"><figcaption><b>Proposed</b> <span class="ops-line" id="lk-where-after"></span></figcaption><div class="lk-map" id="lk-after"></div><p class="ops-line lk-caption" id="lk-caption-after"></p></figure>' +
      "</div><dl class=\"lk-fields\" id=\"lk-fields\"></dl><div id=\"lk-decide\"></div></section>";
  }

  // The chosen look's words, fields and decisions (the pictures are drawn apart: drawPictures).
  function renderLook() {
    const r = chosen?.record;
    if (!r) { $("#lk-panel").hidden = true; return; }
    $("#lk-panel").hidden = false;
    $("#lk-name").textContent = chosen.name;
    $("#lk-purpose").textContent = r.purpose || "This look does not say what the layer is for.";
    $("#lk-fields").innerHTML = K.fields(r, data.sources).map(([k, v]) => "<dt>" + esc(k) + "</dt><dd>" + esc(v) + "</dd>").join("");
    $("#lk-decide").innerHTML = r.status !== "proposed"
      ? '<p class="ops-line" id="lk-msg" role="status">' + esc(K.standing(r)) + ". Nothing to decide.</p>"
      : '<div class="lk-actions">' + (confirming
        ? '<p class="answer-sentence" id="lk-confirm">Accepting draws this look on every map that shows ' + esc(chosen.name) + ". Accept it?</p>" +
          '<p class="ln-actions"><button type="button" class="primary" id="lk-accept-yes">Yes, accept it</button> <button type="button" class="link" id="lk-accept-no">Cancel</button></p>'
        : '<p class="ln-actions"><button type="button" class="primary" id="lk-accept">Accept this look</button></p>') +
        '<label class="ln-field"><span><b>Send back with a note</b> <small>What to change: colours, weights, labels, when it shows</small></span><textarea id="lk-note" rows="3" maxlength="2000"></textarea></label>' +
        '<p class="ln-actions"><button type="button" id="lk-send-back">Send back</button></p></div>' +
        '<p class="msg" id="lk-msg" role="status">' + esc(r.returned_note ? "Sent back with: " + r.returned_note : "") + "</p>";
  }

  // The base map of the scale's owner (group_map or farm_map), read once per page.
  function baseOf(owner) {
    const key = owner.kind + ":" + owner.id;
    if (!bases.has(key)) {
      const asked = withTimeout(read(owner.kind === "group" ? FP.sb.rpc("group_map", { g: owner.id }) : FP.sb.rpc("farm_map", { f: owner.id })), MAP_TIMEOUT_MS);
      bases.set(key, asked); asked.catch(() => bases.delete(key));
    }
    return bases.get(key);
  }
  function surfaces() {
    if (!pictures) pictures = { before: FP.mapScene.engine($("#lk-before")), after: FP.mapScene.engine($("#lk-after")) };
    return pictures;
  }
  // The two pictures of the chosen look at the chosen scale: the same scene (the look's own layers and sources), today's draw
  // and the preview's. Bounded as the maps' own reads: a deferred layer by the frame's box, a source by the owner's context.
  async function drawPictures() {
    const mine = ++drawing, r = chosen?.record;
    if (!r) return;
    delete $("#lk-panel").dataset.drawn;   // set again once both pictures are painted (the gallery waits for it)
    const owner = scale === "group" ? { kind: "group", id: owners.group } : { kind: "farm", id: owners.farm };
    const where = scale === "group" ? data.groups.find((g) => g.id === owner.id)?.name : data.farms.find((f) => f.id === owner.id)?.name;
    for (const k of ["before", "after"]) { $("#lk-where-" + k).textContent = where ? "· " + where + ", " + (scale === "group" ? "the whole group" : "a paddock or two") : ""; $("#lk-caption-" + k).textContent = "Drawing…"; }
    const say = (t) => { for (const k of ["before", "after"]) $("#lk-caption-" + k).textContent = t || ""; };
    if (!owner.id) { say(scale === "group" ? "No catchment group to draw on." : "No farm to draw on."); return; }
    try {
      const base = await baseOf(owner);
      if (mine !== drawing) return;
      if (!base?.extent) { say("Nothing is mapped there yet."); return; }
      const box = K.frame(scale, base.extent), features = {}, tooMany = [], failed = [];
      for (const l of K.layersFor(r, base)) {
        if (!l.deferred || !l.id) continue;
        const c = K.layerRead(scale, owner, l.id, box);
        const res = await Promise.resolve(FP.sb.rpc(c.fn, c.args)).catch((e) => ({ error: e }));
        if (res?.error) failed.push(l.name); else if (res?.data?.truncated) tooMany.push(l.name); else if (res?.data?.features) features[l.id] = res.data.features;
      }
      const reference = [], notServed = [], noData = [], notHere = [], noneNear = [], riversRow = [];
      for (const key of K.sourcesFor(r, data.sources)) {
        const row = data.sources.find((s) => s.key === key) || null, name = row?.name || key;
        // a source no person is served is not read at all: its picture says so
        const res = row?.serve_to_customers === false ? null : await Promise.resolve(contextOf(owner, key)).catch((e) => ({ error: e }));
        const state = K.sourceState(row, res, { scale, key });
        if (state === "not_served") notServed.push(name); else if (state === "no_data") noData.push(name); else if (state === "not_here") notHere.push(name);
        else if (state === "none_near") noneNear.push(name); else if (state === "rivers_row") riversRow.push(key);
        else if (state === "failed") failed.push(name); else if (state === "too_many") tooMany.push(res.data.name || name); else reference.push(res.data);
      }
      if (mine !== drawing) return;
      const sc = K.scene(base, r, { features, reference }), show = K.show(r), s = surfaces();
      await s.before.open(null, sc, { show });
      await s.after.open(null, JSON.parse(JSON.stringify(sc)), { show, stylePreview: [r] });
      if (mine !== drawing) return;
      // flat, so the two frames stay the same (no re-grounding on the hills) and the paddock frame holds
      s.before.terrain(false); s.after.terrain(false);
      // each scale's frame, fitted to the picture (the map's own frame pads for a full-screen map with its panel beside it)
      // (after the open's own settle, which waits for the map's first idle and may ease back to the whole extent)
      const rest = async () => { await Promise.all([s.before.atRest(), s.after.atRest()]); await Promise.all([s.before.whenIdle(), s.after.whenIdle()]); await Promise.all([s.before.atRest(), s.after.atRest()]); };
      await rest();
      if (mine !== drawing) return;
      s.before.frame(K.polygon(box)); s.after.frame(K.polygon(box));
      await Promise.all([s.before.atRest(), s.after.atRest()]);
      await Promise.all([s.before.whenIdle(), s.after.whenIdle()]);
      if (mine !== drawing) return;
      say(K.caption(r, sc, { tooMany, failed, notServed, noData, notHere, noneNear, riversRow, scale }));
      $("#lk-panel").dataset.drawn = r.id + ":" + scale;
    } catch (e) {
      if (mine === drawing) say("The map couldn't be drawn just now: " + (e.message || e) + ".");
    }
  }

  function choose(id) {
    const rows = K.rows(data.styles, data.sources);
    chosen = rows.find((x) => x.id === id) || rows.find((x) => x.open) || rows[0] || null;
    confirming = false;
    renderLook(); drawPictures();
  }
  // The looks read again (after a decision the database refused as stale): the page draws the look as it is now.
  async function reread() {
    data.styles = await sharedLooks();
    const id = chosen?.id;
    $("#lk-look").innerHTML = K.rows(data.styles, data.sources).map((x) => '<option value="' + esc(x.id) + '"' + (x.id === id ? " selected" : "") + ">" + esc(x.name + " · " + x.standing) + "</option>").join("");
    choose(id);
  }
  async function decide(kind) {
    const r = chosen?.record, msg = () => $("#lk-msg");
    if (!r || r.status !== "proposed") return;
    let text = null;
    if (kind === "back") { const n = K.note($("#lk-note")?.value); if (!n.ok) { msg().textContent = n.error; return; } text = n.text; }
    const call = kind === "accept" ? K.acceptCall(r) : K.sendBackCall(r, text);
    for (const b of document.querySelectorAll("#lk-decide button")) b.disabled = true;
    msg().textContent = kind === "accept" ? "Accepting…" : "Sending it back…";
    let res;
    try { res = await FP.sb.rpc(call.fn, call.args); } catch (e) { res = { error: e }; }
    if (res?.error || !res?.data) {
      const said = K.refusal(res?.error || Error("no answer"), kind === "accept" ? "accept" : "back");
      if (K.stale(res?.error)) { try { await reread(); } catch {} }
      else { confirming = false; renderLook(); }
      msg().textContent = said;
      return;
    }
    data.styles = data.styles.map((x) => (x.id === res.data.id ? res.data : x));
    if (kind === "accept") data.styles = data.styles.map((x) => (x.id !== res.data.id && x.status === "reviewed" && !x.superseded_at && K.target(x).key === K.target(res.data).key ? { ...x, superseded_at: res.data.reviewed_at } : x));
    const id = chosen.id;
    $("#lk-look").innerHTML = K.rows(data.styles, data.sources).map((x) => '<option value="' + esc(x.id) + '"' + (x.id === id ? " selected" : "") + ">" + esc(x.name + " · " + x.standing) + "</option>").join("");
    chosen = K.rows(data.styles, data.sources).find((x) => x.id === id) || chosen; confirming = false;
    renderLook();
    msg().textContent = kind === "accept" ? "Accepted. It is now how " + chosen.name + " is drawn on every map that shows it." : "Sent back with your note. It stays proposed, drawn only here, for its proposer to change.";
  }

  const wired = new WeakSet();
  function wire(box) {
    if (wired.has(box)) return;
    wired.add(box);
    box.addEventListener("change", (e) => {
      if (!data || !document.querySelector("#lk-panel")) return;
      if (e.target.id === "lk-look") choose(e.target.value);
      else if (e.target.id === "lk-scale") { scale = e.target.value === "paddock" ? "paddock" : "group"; drawPictures(); }
      else if (e.target.id === "lk-group") { owners.group = e.target.value || null; if (scale === "group") drawPictures(); }
      else if (e.target.id === "lk-farm") { owners.farm = e.target.value || null; if (scale === "paddock") drawPictures(); }
    });
    box.addEventListener("click", (e) => {
      if (!data || !document.querySelector("#lk-panel")) return;
      const id = e.target.closest?.("button")?.id;
      if (id === "lk-accept") { confirming = true; renderLook(); }
      else if (id === "lk-accept-no") { confirming = false; renderLook(); }
      else if (id === "lk-accept-yes") decide("accept");
      else if (id === "lk-send-back") decide("back");
    });
  }

  async function open() {
    const current = ++token, box = $("#ops-panels");
    close(true);
    document.body.classList.remove("farm-space-active", "farm-detail", "portfolio-active");
    FP.show("screen-ops");
    document.title = "Layer looks | " + FP.brand?.product;
    $("#ops-title").textContent = "Layer looks";
    $("#ops-back").setAttribute("href", FP.href(""));
    const tab = $("#ops-tab"); tab.textContent = "Operations"; tab.setAttribute("href", FP.href("#/ops"));
    $("#ops-tab-wrap")?.toggleAttribute("hidden", false);
    // Row-level security and the two functions are the real gate (a shared look is decided by staff alone); not drawing the
    // page for anyone else is a courtesy.
    if (!FP.ops.isStaff()) { box.innerHTML = '<section class="answer-panel answer-compact ops-panel" data-ops="looks" data-offered="none"><h2>Layer looks</h2><p class="answer-sentence" id="lk-none">Only RCL staff decide layer looks.</p></section>'; return; }
    box.innerHTML = '<p class="ops-wait">Reading the looks…</p>';
    try {
      const [styles, sources, groups, farms] = await Promise.all([
        sharedLooks(),
        read(FP.sb.from("reference_sources").select("key,name,theme,serve_to_customers,feature_count").order("name").limit(MAX_ROWS)),
        optional(FP.sb.from("organisations").select("id,name,kind").eq("kind", "catchment_group").order("name").limit(MAX_ROWS)),
        optional(FP.sb.from("farms").select("id,name").order("name").limit(MAX_ROWS)),
      ]);
      if (current !== token) return;
      data = { styles, sources: sources || [], groups: groups.filter((g) => g.kind === "catchment_group"), farms };
      owners = { group: data.groups[0]?.id || null, farm: data.farms[0]?.id || null };
      chosen = K.rows(data.styles, data.sources).find((x) => x.open) || K.rows(data.styles, data.sources)[0] || null;
      box.innerHTML = shell();
      wire(box);
      renderLook(); drawPictures();
    } catch (e) {
      if (current === token) box.innerHTML = '<p class="ops-wait" role="alert">Couldn\'t read the looks: ' + esc(e.message || e) + "</p>";
    }
  }
  // Leaving the page removes its two maps (each a WebGL context and the engine's listeners).
  function close(keepToken = false) {
    if (!keepToken) token++;
    drawing++;
    pictures?.before.remove(); pictures?.after.remove(); pictures = null; bases = new Map();
  }

  FP.opsLooks = { open, close, state: () => ({ chosen: chosen?.id || null, scale, owners: { ...owners }, confirming }) };
})();
