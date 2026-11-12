// NP1b: a farm's working notes (public.farm_working_notes, migration 20261113062000; the owner's decision of 13 Nov 2026 that a farm
// never sees notes written by the coordinator or staff). Coordinators' and staff's own lines about a farm, shown at the foot of the
// farm's Home as a quiet "Working notes (not shown to the farm)" block, only to those the database lets read and write them
// (public.farm_working_notes_allowed: RCL staff on the farm, and the facilitators, advisors and admins of a group the farm is actively
// associated with who hold no role on it); for everyone else the block is never drawn. A note is added in a line, the list is newest
// first, and a note is archived, never deleted. Every read and write is as the signed-in person (row-level security decides).
(function (root) {
  const FP = root.FP = root.FP || {};
  const el = (...a) => FP.el(...a);
  const COLS = "id,farm_id,about_kind,about_id,body,created_by,created_at,archived_at";
  const CAP = 200;          // the newest this many notes are listed
  const MAX = 4000;         // characters in a note (the database's check)
  const day = (t) => { try { return new Date(t).toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric", timeZone: "Pacific/Auckland" }); } catch { return ""; } };

  // Whether the person may, and if so the farm's notes that are not archived, newest first (at most CAP). Anyone else: { allowed: false }.
  async function load(sb, farmId) {
    const ok = await Promise.resolve(sb.rpc("farm_working_notes_allowed", { f: farmId })).then((r) => !r?.error && r?.data === true, () => false);
    if (!ok) return { allowed: false, notes: [] };
    const r = await Promise.resolve(sb.from("farm_working_notes").select(COLS).eq("farm_id", farmId).is("archived_at", null)
      .order("created_at", { ascending: false }).range(0, CAP - 1)).catch((e) => ({ error: e }));
    if (r?.error) return { allowed: true, notes: [], failed: r.error.message || String(r.error) };
    return { allowed: true, notes: (Array.isArray(r?.data) ? r.data : []).filter((n) => !n.archived_at).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))) };
  }
  // A line as typed to the row the database takes, or the plain reason it can't be saved.
  function toRow(farmId, text) {
    const body = String(text ?? "").trim();
    if (!body) return { error: "Type the note first." };
    if (body.length > MAX) return { error: "A note is at most " + MAX.toLocaleString("en-NZ") + " characters." };
    return { row: { farm_id: farmId, body } };
  }

  // The block for one farm: empty and hidden until the database says the person may; never drawn for anyone else.
  function view(farmId, opts = {}) {
    const sb = opts.sb || FP.sb;
    const box = el("section", { class: "working-notes", id: "working-notes", "aria-labelledby": "working-notes-title", hidden: true });
    const st = { notes: [], failed: null, msg: "" };
    function draw(focus) {
      const input = el("input", { id: "working-note-text", type: "text", maxlength: String(MAX), autocomplete: "off", placeholder: "Add a working note", "aria-label": "A working note, not shown to the farm" });
      const add = el("button", { type: "submit", id: "working-note-add", class: "secondary" }, "Add");
      const msg = el("p", { class: "working-notes-msg", role: "status", id: "working-note-msg" }, st.msg || "");
      const form = el("form", { class: "working-notes-add" }, input, add);
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const { row, error } = toRow(farmId, input.value);
        if (error) { st.msg = error; draw("input"); return; }
        add.disabled = true;
        const r = await Promise.resolve(sb.from("farm_working_notes").insert(row).select(COLS).single()).catch((x) => ({ error: x }));
        if (r?.error) { st.msg = "Couldn't add the note: " + (r.error.message || r.error); add.disabled = false; draw("input"); return; }
        st.notes = [{ ...row, created_at: new Date().toISOString(), ...(r.data || {}) }, ...st.notes];
        st.msg = "Added.";
        draw("input");
      });
      const list = st.notes.length
        ? el("ul", { class: "working-notes-list" }, ...st.notes.map((n) => el("li", { "data-note": n.id },
          el("span", { class: "working-notes-text" }, el("span", {}, n.body), el("small", {}, day(n.created_at))),
          el("button", { type: "button", class: "link", id: "working-note-archive-" + n.id, "aria-label": "Archive the note: " + String(n.body).slice(0, 60), onclick: () => archive(n) }, "Archive"))))
        : el("p", { class: "working-notes-empty" }, st.failed ? "Couldn't read the working notes just now: " + st.failed : "No working notes yet.");
      box.replaceChildren(
        el("h2", { id: "working-notes-title" }, "Working notes ", el("small", {}, "(not shown to the farm)")),
        form, msg, list);
      if (focus === "input") box.querySelector?.("#working-note-text")?.focus?.();
    }
    async function archive(n) {
      const r = await Promise.resolve(sb.from("farm_working_notes").update({ archived_at: new Date().toISOString() }).eq("id", n.id)).catch((x) => ({ error: x }));
      if (r?.error) st.msg = "Couldn't archive the note: " + (r.error.message || r.error);
      else { st.notes = st.notes.filter((x) => x.id !== n.id); st.msg = "Archived. It is kept, not deleted."; }
      draw("input");
    }
    box.ready = load(sb, farmId).then((got) => {
      if (!got.allowed) { box.remove?.(); return got; }
      st.notes = got.notes; st.failed = got.failed || null;
      draw(); box.hidden = false;
      return got;
    });
    return box;
  }

  FP.workingNotes = { load, toRow, view, CAP, MAX };
})(typeof window === "undefined" ? globalThis : window);
