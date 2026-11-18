// FP2: "Plans to place" (under More, for the group's facilitators, advisors and admins): one card per member whose current farm plan
// RCL couldn't tell. The list first (who is waiting, why, the status); a card shows the question, each candidate file opened in the
// app's own viewer, and the member's place on the group's map beside it (one above the other on a phone), with the answers: one of
// the files, none of these, or something else with a note. One primary action. Once answered, the card says what, who and when, and
// offers Change until RCL applies it.
//
// Reads, as the person (row-level security decides): public.proposals of kind plan_choice for the group; group_members for the names;
// documents for the candidate files (held: the group's coordinators and RCL staff); crm_team for who answered. Writes: only
// public.plan_choice_answer. A file is fetched and shown as an object URL of its own type (never a storage address on screen or in
// the address bar), read through FL2's reader with cache: "no-store"; a PDF is framed in the card on a computer, anything else (and
// every file on a phone) opens in FL2's viewer. A plan's ratings and actions are not
// shown: this is about which file is the plan, not what the plan says.
(function (root) {
  const FP = root.FP;
  const M = () => FP.plansPlaceModel;
  const el = (...a) => FP.el(...a);
  const COLS = "id,org_id,kind,subject,subject_key,evidence,candidates,status,decision,decided_by,decided_at,applied_at";
  const MAX_BYTES = 50 * 1024 * 1024;
  let shown = null;

  const rowsOf = async (q) => { try { const r = await q; return r?.error ? null : r?.data || []; } catch { return null; } };
  const href = (group, item = null) => FP.href(FP.groupModel.href(group.id, "plans", item));

  function view(group, { sb = FP.sb, item = null, person = null } = {}) {
    close();
    const me = { alive: true, urls: new Set(), reads: new Set(), fv: null, map: null };
    shown = me;
    const live = () => me.alive && shown === me;
    const wrap = el("section", { class: "plans-place", "data-view": "plans", "data-group": group.id, "aria-labelledby": "pp-title" });
    if (!M().canSee(group.role)) {
      wrap.append(el("h2", { id: "pp-title" }, "Plans to place"), el("p", { class: "pp-quiet", id: "pp-none" }, "This page is for the group's coordinators."));
      return wrap;
    }
    const ctx = { group, sb, live, wrap, me, person };
    if (item) drawCard(ctx, item); else drawList(ctx);
    return wrap;
  }
  function close() {
    if (!shown) return;
    shown.alive = false;
    for (const u of shown.urls) { try { root.URL.revokeObjectURL(u); } catch { /* gone */ } }
    shown.urls.clear();
    for (const c of shown.reads) { try { c.abort(); } catch { /* done */ } }
    shown.reads.clear();
    try { shown.fv?.close(); } catch { /* already closed */ } shown.fv = null;
    dropMap(shown);
    shown = null;
  }
  function dropMap(me) { if (me?.map) { try { me.map.remove(); } catch { /* already gone */ } me.map = null; } }

  // ==== the list ====================================================================================================================
  async function drawList(ctx) {
    const { group, sb, wrap } = ctx;
    const status = el("p", { class: "pp-quiet pp-status", role: "status" }, "Loading…");
    wrap.replaceChildren(el("div", { class: "pp-head" }, el("h2", { id: "pp-title" }, "Plans to place"),
      el("p", { class: "pp-quiet" }, "For each member below RCL couldn't tell which file is the current farm plan. Pick it with the file and the place in view. RCL loads the plan you pick; until then you can change your answer.")),
      status);
    const [rows, members] = await Promise.all([
      rowsOf(sb.from("proposals").select(COLS).eq("org_id", group.id).eq("kind", "plan_choice").in("status", ["proposed", "ambiguous", "accepted", "applied"]).order("id").limit(500)),
      rowsOf(sb.from("group_members").select("id,member_number,business_name").eq("org_id", group.id).limit(5000)),
    ]);
    if (!ctx.live()) return;
    if (rows == null) { status.textContent = "The plans to place couldn't be read just now."; return; }
    const sorted = M().sortRows(rows);
    status.textContent = rows.length ? M().summary(rows) : "";
    if (!rows.length) { wrap.append(el("p", { class: "pp-empty", id: "pp-empty" }, "Nothing to place: RCL has no plan question for this group.")); return; }
    wrap.append(el("ul", { class: "pp-list" }, ...sorted.map((r) => {
      const st = M().statusOf(r);
      return el("li", {}, el("a", { class: "pp-row", href: href(group, String(r.id)), "data-proposal": String(r.id), "data-state": st.key },
        el("span", { class: "pp-text" }, el("b", {}, M().title(r, members)), el("small", {}, M().whyLine(r.subject?.why))),
        el("span", { class: "pp-state" }, st.text), FP.icon ? FP.icon("chevron", 14) : null));
    })));
  }

  // ==== one card =======================================================================================================================
  async function drawCard(ctx, id) {
    const { group, sb, wrap } = ctx;
    const back = el("a", { class: "pp-back", href: href(group) }, FP.icon ? FP.icon("back", 18) : null, el("span", {}, "Plans to place"));
    const status = el("p", { class: "pp-quiet pp-status", role: "status" }, "Loading…");
    wrap.replaceChildren(back, status);
    const [rows, members, team] = await Promise.all([
      rowsOf(sb.from("proposals").select(COLS).eq("org_id", group.id).eq("kind", "plan_choice").eq("id", Number(id)).limit(1)),
      rowsOf(sb.from("group_members").select("id,member_number,business_name").eq("org_id", group.id).limit(5000)),
      rowsOf(sb.rpc("crm_team", { g: group.id })),
    ]);
    if (!ctx.live()) return;
    const row = rows?.[0];
    if (!row) { status.textContent = rows == null ? "This question couldn't be read just now." : "There is no such question for this group."; return; }
    const fileList = M().files(row);
    const docs = fileList.length ? await rowsOf(sb.from("documents").select("id,title,storage_path,size_bytes").in("id", fileList.map((f) => f.document_id))) : [];
    if (!ctx.live()) return;
    status.remove();
    const viewed = [];
    const fileNode = (f) => {
      const viewer = el("div", { class: "pp-viewer", hidden: "" });
      const open = el("button", { type: "button", class: "secondary pp-open", "data-file": f.document_id }, "Open");
      open.addEventListener("click", () => openFile(ctx, f, (docs || []).find((d) => d.id === f.document_id), viewer, open, viewed));
      return el("li", { class: "pp-file" }, el("div", { class: "pp-file-head" }, el("span", { class: "pp-text" }, el("b", {}, f.title), el("small", {}, M().fileLine(f))), open), viewer);
    };
    const place = M().placeOf(row);
    const mapBox = place ? el("div", { class: "pp-map", role: "img", "aria-label": "Map: member " + row.subject?.member + "'s blocks on the group's map" }) : null;
    const where = el("section", { class: "pp-where", "aria-labelledby": "pp-where-h" }, el("h3", { id: "pp-where-h" }, "Where the member is"),
      mapBox || el("p", { class: "pp-quiet", id: "pp-no-place" }, "This member has no block on the group's map yet, so the place can't be shown."));
    const filesBox = el("section", { class: "pp-files", "aria-labelledby": "pp-files-h" }, el("h3", { id: "pp-files-h" }, "The files"),
      fileList.length ? el("ul", { class: "pp-file-list" }, ...fileList.map(fileNode)) : el("p", { class: "pp-quiet" }, "No file is held for this member: answer with none of these, or say what the plan is in a note."));
    const card = el("article", { class: "pp-card", "data-proposal": String(row.id) },
      el("h2", { id: "pp-title" }, M().title(row, members)),
      el("p", { class: "pp-question" }, M().question(row)),
      el("p", { class: "pp-quiet" }, M().whyLine(row.subject?.why)),
      el("div", { class: "pp-inview" }, filesBox, where),
      answerBlock(ctx, row, team, viewed, place));
    wrap.append(card);
    if (place && mapBox) drawMap(ctx, mapBox, place, row, viewed);
  }

  // The answer: what was picked, by whom and when, with Change until applied; or the choices and one primary action
  function answerBlock(ctx, row, team, viewed, place) {
    const box = el("section", { class: "pp-answer", "aria-labelledby": "pp-answer-h" }, el("h3", { id: "pp-answer-h" }, "Your answer"));
    const me = ctx.person?.id || null;
    if (row.decision && (row.status === "accepted" || row.status === "applied")) {
      const when = row.decided_at ? new Date(row.decided_at).toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric", timeZone: "Pacific/Auckland" }) : "";
      const done = el("div", { class: "pp-done", id: "pp-done" },
        el("p", {}, el("b", {}, M().answerText(row.decision))),
        el("p", { class: "pp-quiet" }, "Answered by " + M().who(row.decided_by, me, team) + (when ? " on " + when : "") + "."),
        row.status === "applied" ? el("p", { class: "pp-quiet" }, "RCL has applied this answer, so it no longer changes.")
          : el("p", { class: "pp-quiet" }, "RCL hasn't applied it yet, so it can still be changed."));
      box.append(done);
      if (M().changeable(row)) {
        const change = el("button", { type: "button", class: "secondary pp-change", id: "pp-change" }, "Change");
        change.addEventListener("click", () => { done.remove(); change.remove(); box.append(form(ctx, row, viewed, place, row.decision)); });
        box.append(change);
      }
      return box;
    }
    box.append(form(ctx, row, viewed, place, null));
    return box;
  }
  function form(ctx, row, viewed, place, was) {
    const name = "pp-pick-" + row.id;
    const options = (row.candidates || []).map((c, i) => {
      const pick = M().pickOf(c), id = name + "-" + i;
      const label = c.file ? c.file.title : c.choice === "none" ? "None of these" : "Something else (say what in the note)";
      const input = el("input", { type: "radio", name, id, value: pick, ...(was && M().pickOf(was.candidate) === pick ? { checked: true } : {}) });
      return el("label", { class: "pp-option", for: id }, input, el("span", {}, label));
    });
    const note = el("textarea", { id: "pp-note", rows: "2", maxlength: "2000", placeholder: "A note for RCL (needed for something else)" });
    if (was?.note) note.value = was.note;
    const msg = el("p", { class: "pp-msg", role: "status" });
    const save = el("button", { type: "submit", class: "primary", id: "pp-save" }, was ? "Save the change" : "Save the answer");
    const f = el("form", { class: "pp-form" }, el("fieldset", {}, el("legend", {}, "Which is the current plan?"), ...options),
      el("label", { class: "pp-note-label", for: "pp-note" }, "Note"), note, msg, save);
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const pick = f.querySelector('input[type="radio"]:checked')?.value;
      if (!pick) { msg.textContent = "Pick one of the answers."; return; }
      if (pick === "other" && !note.value.trim()) { msg.textContent = "Say in the note what the current plan is."; return; }
      save.disabled = true; msg.textContent = "Saving…";
      let r;
      try { r = await ctx.sb.rpc("plan_choice_answer", { id: row.id, pick, note: note.value.trim() || null, viewed: viewed.length ? viewed.slice(-10) : null }); } catch (err) { r = { error: err }; }
      if (!ctx.live()) return;
      save.disabled = false;
      if (r?.error) { msg.textContent = "Couldn't save: " + (r.error.message || "try again"); return; }
      drawCard(ctx, String(row.id));
    });
    return f;
  }

  // ==== a file, in the app's own viewer ==================================================================================================
  // FL2: a stored file is read with the person's own sign-in through FL2's reader (FP.fileView.fetch: Storage's download, cache:
  // "no-store", so no copy is kept for the next person on this device) and never through a signed link. On a computer a PDF is framed
  // in the card, beside the member's place, so the coordinator decides with both in view; anything else, and every file on a phone,
  // opens in FL2's viewer (FP.fileView.open: its Close and Escape, its large-file line, its Open and Share or save). Each blob: address
  // made here is released when the card closes.
  const phone = () => !!root.matchMedia?.("(max-width: 800px)").matches;
  async function openFile(ctx, f, doc, viewer, button, viewed) {
    const say = (text) => { viewer.hidden = false; viewer.replaceChildren(el("p", { class: "pp-quiet" }, text)); };
    if (!doc?.storage_path || !FP.fileView) { say("This file can't be opened here: it may not be held any more."); return; }
    const pdf = FP.fileView.kindOf(doc.storage_path) === "pdf";
    if (!pdf || phone()) {
      ctx.me.fv = FP.fileView.open({ sb: ctx.sb, path: doc.storage_path, name: f.title, title: f.title, size: doc.size_bytes, opener: button });
      viewed.push({ kind: "document", document_id: f.document_id, at: new Date().toISOString() });
      return;
    }
    if (Number(doc.size_bytes) > MAX_BYTES) { say("This file is too large to show here."); return; }
    const was = button.textContent;
    button.disabled = true; button.textContent = "Opening…";
    say(FP.fileView.loadingLine(f.title, doc.size_bytes));
    const ctl = root.AbortController ? new root.AbortController() : null;
    if (ctl) ctx.me.reads.add(ctl);
    let blob = null;
    try { blob = await FP.fileView.fetch(ctx.sb, doc.storage_path, { signal: ctl?.signal }); } catch { blob = null; }
    if (ctl) ctx.me.reads.delete(ctl);
    button.disabled = false; button.textContent = was;
    if (!ctx.live()) return;
    if (!blob) { say(FP.fileView.failedLine(f.title, root.navigator?.onLine === false)); return; }
    const url = root.URL.createObjectURL(new root.Blob([blob], { type: "application/pdf" }));
    ctx.me.urls.add(url);
    viewer.hidden = false;
    viewer.replaceChildren(el("iframe", { class: "pp-frame", src: url, title: "The file: " + f.title }));
    viewed.push({ kind: "document", document_id: f.document_id, at: new Date().toISOString() });
  }

  // ==== the place, on a small map of its own =============================================================================================
  // One map at a time (this card's), drawn once into a box of a fixed size and removed with the card: no listener outlives it.
  async function drawMap(ctx, box, place, row, viewed) {
    if (typeof root.maplibregl === "undefined" || !FP.mapScene?.engine) { box.replaceChildren(el("p", { class: "pp-quiet" }, "The map isn't available in this browser.")); return; }
    dropMap(ctx.me);
    const surface = FP.mapScene.engine(box);
    ctx.me.map = surface;
    const EMPTY = { type: "FeatureCollection", features: [] };
    const scene = { farm: { id: null, name: "Member " + row.subject?.member }, extent: place.geometry, extent_label: "Member " + row.subject?.member + "'s blocks",
      titles: EMPTY, land_units: EMPTY, layers: [], reference: [] };
    let opened = null;
    try { opened = await surface.open(null, scene, { show: ["extent"] }); } catch { opened = null; }
    if (!ctx.live() || ctx.me.map !== surface || !box.isConnected) { try { surface.remove(); } catch { /* gone */ } return; }
    if (!opened) { dropMap(ctx.me); box.replaceChildren(el("p", { class: "pp-quiet" }, "The map couldn't be drawn just now.")); return; }
    surface.frame(place.geometry);
    box.dataset.map = "drawn";
    viewed.push({ kind: "feature", bbox: place.bbox, at: new Date().toISOString() });
  }

  FP.plansPlace = { view, close };
})(typeof window === "undefined" ? globalThis : window);
