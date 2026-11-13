// UI1: Add (+). One button in every space (a round button over the bottom right on a phone, "+ Add" in the space's header on a
// computer) opens a sheet listing what THIS person may add in THIS space. What can be added is a small registry, so a later item
// brings its own action without touching the button:
//
//   FP.add.register({ id, label, hint, icon, where: ["farm", "group"], order, can(ctx), run(ctx), verb? })
//
// verb (J2): the words Home shows the action with, openly (place-home-model.js: "Add a file"); without one, "Add " and the label.
//
// ctx: { space: "farm" | "group", id, name, role (the person's farm_members or org_members role), staff (profiles.is_staff),
//        views: the space's views this person can open (the tab keys, so the simple view's allow-list rules here too), view }
// can(ctx) is pure (no reads): only actions it allows are listed, and the button shows only when at least one is. Nothing is
// listed as a placeholder. Which roles may write is the existing models' rule (farm-model canEdit, group-model canWrite), the
// same the database's policies enforce; this file only decides what to offer. Today: File (to the space's Files, through its
// existing add flow) and, in a group, Event (the new event form, events.js).
(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const api = factory(root, node ? { farm: require("./farm-model.js"), group: require("./group-model.js"), people: require("./people-model.js") } : null);
  if (node) module.exports = api; else { root.FP = root.FP || {}; root.FP.add = api; }
})(typeof window === "undefined" ? globalThis : window, function (root, nodeModels) {
  const models = () => nodeModels || { farm: root.FP.farmModel, group: root.FP.groupModel, people: root.FP.peopleModel };

  // ---- the registry (pure) ------------------------------------------------------------------------------------------------
  function createRegistry() {
    const actions = [];
    function register(a) {
      for (const k of ["id", "label", "icon"]) if (typeof a?.[k] !== "string" || !a[k]) throw new Error("an Add action needs a " + k);
      if (!Array.isArray(a.where) || !a.where.length || a.where.some((w) => !["farm", "group"].includes(w))) throw new Error("an Add action's where is farm and/or group: " + a.id);
      if (typeof a.can !== "function" || typeof a.run !== "function") throw new Error("an Add action needs can(ctx) and run(ctx): " + a.id);
      if (actions.some((x) => x.id === a.id)) throw new Error("an Add action is registered once: " + a.id);
      actions.push({ order: 100, hint: "", ...a });
      actions.sort((x, y) => x.order - y.order || x.label.localeCompare(y.label));
      return a.id;
    }
    // What this person may add here, in the sheet's order. A can() that throws offers nothing (it never breaks the others).
    function available(ctx) {
      if (!ctx || !["farm", "group"].includes(ctx.space)) return [];
      return actions.filter((a) => { try { return a.where.includes(ctx.space) && a.can(ctx) === true; } catch { return false; } });
    }
    return { register, available, list: () => actions.slice() };
  }

  const views = (ctx) => (Array.isArray(ctx?.views) ? ctx.views : []);
  // Who may add a file: a farm's owners, admins and editors; a group's editors, facilitators, advisors and admins; and only where
  // the person can open the space's Files. A farm's Files takes new files only where the database records who chose a file's
  // tier (documentTiers "chosen", farm-space.js editor()): anywhere else the farm's Files offers no add, so neither does this.
  const mayAddFile = (ctx) => views(ctx).includes("documents") &&
    (ctx.space === "farm" ? models().farm.canEdit(ctx.role) && ctx.documentTiers === "chosen" : models().group.canWrite(ctx.role));
  const mayAddEvent = (ctx) => ctx.space === "group" && views(ctx).includes("events") && models().group.canWrite(ctx.role);
  // PE1's People: a call or meeting note and a person, for the roles its own rule lets see People (people.js addEntries' shows:
  // people-model canSee, the group's facilitators, advisors and admins), and only where the People tab is the person's
  const mayAddPeople = (ctx) => ctx.space === "group" && views(ctx).includes("people") && !!models().people?.canSee(ctx.role);

  // CAP1: a photo with tags (and a water sample or pest control, built on it), for any member of a group or sub-group, where its
  // Records are the person's (the simple view's allow-list rules here too). Saved to the group the person is in; a member's own
  // capture is read by them and the group's coordinators (public.captures). Not offered in a farm in this version.
  const MEMBER_ROLES = ["member", "editor", "facilitator", "advisor", "admin"];
  const mayCapture = (ctx) => ctx.space === "group" && MEMBER_ROLES.includes(ctx.role) && views(ctx).includes("records");

  const registry = createRegistry();
  // short: the one line under an option in the phone's + ring (capture-ring.js), where there is room for a word or two
  registry.register({ id: "photo", label: "Photo", short: "Photo", hint: "A photo with tags: anything worth keeping", icon: "camera", where: ["group"], order: 1, verb: "Take a photo",
    can: mayCapture, run: (ctx) => root.FP.captures.start(ctx, "photo") });
  registry.register({ id: "water_sample", label: "Water sample", short: "Water", hint: "A photo of the sample or tester, with readings", icon: "water", where: ["group"], order: 2, verb: "Record a water sample",
    can: mayCapture, run: (ctx) => root.FP.captures.start(ctx, "water_sample") });
  registry.register({ id: "pest_control", label: "Pest control", short: "Pests", hint: "What you saw or shot, and how many", icon: "pest", where: ["group"], order: 3, verb: "Record pest control",
    can: mayCapture, run: (ctx) => root.FP.captures.start(ctx, "pest_control") });
  registry.register({ id: "file", label: "File", short: "File", hint: "A plan, consent or report, to the space's Files", icon: "file", where: ["farm", "group"], order: 10, verb: "Add a file",
    can: mayAddFile, run: (ctx) => addFile(ctx) });
  registry.register({ id: "event", label: "Event", short: "Event", hint: "A meeting, field day or workshop", icon: "event", where: ["group"], order: 20, verb: "Add an event",
    can: mayAddEvent, run: (ctx) => root.FP.groupEvents.openNew(ctx.id) });
  registry.register({ id: "interaction", label: "Call or meeting note", short: "Call", hint: "A call, visit or meeting, in the group's log", icon: "note", where: ["group"], order: 30, verb: "Log a call or visit",
    can: mayAddPeople, run: (ctx) => root.FP.groupPeople.logInteraction(ctx.id) });
  registry.register({ id: "person", label: "Person", short: "Person", hint: "Someone the group works with", icon: "person", where: ["group"], order: 40, verb: "Add a person",
    can: mayAddPeople, run: (ctx) => root.FP.groupPeople.addPerson(ctx.id) });

  // ---- the actions, in the browser ------------------------------------------------------------------------------------------
  const FP = () => root.FP;
  const href = (ctx, view) => FP().href((ctx.space === "farm" ? models().farm : models().group).href(ctx.id, view));
  // Wait for the first element `pick` returns (the Files view draws after its reads); null after `ms`.
  function waitFor(pick, ms = 15000) {
    return new Promise((resolve) => {
      if (pick()) { resolve(pick()); return; }
      const obs = new MutationObserver(() => { const found = pick(); if (found) { obs.disconnect(); clearTimeout(t); resolve(found); } });
      const t = setTimeout(() => { obs.disconnect(); resolve(null); }, ms);
      obs.observe(root.document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "class"] });
    });
  }
  // The element `pick` returns once it has stayed the same for a short quiet spell (a view drawn twice in a row gives the second)
  async function settled(pick, quiet = 350) {
    let found = await waitFor(pick);
    for (let n = 0; found && n < 20; n++) {
      await new Promise((r) => setTimeout(r, quiet));
      const again = pick();
      if (again === found) return found;
      found = again || await waitFor(pick);
    }
    return found;
  }
  // The screen a space's Files is drawn in: a farm's in the farm screen's panel, a group's in the group's panel
  const SCREENS = { farm: "#screen-map #space-body", group: "#screen-group #group-panel" };
  const FILE_INPUT = '[data-view="documents"] [data-doc-file]';
  const MOVED = { moved: true };   // (settled's answer when the route left the space's Files before it drew)
  // A Files add input that is shown now, in this space's screen, and (when the route is changing) not one drawn before it changed:
  // an earlier Files view stays in the page, hidden, under Maps or another space, and must never take the files.
  function liveInput(ctx, stale, target) {
    if (root.location.hash !== target) return null;   // the person has gone somewhere else: nothing here takes the files
    const screen = root.document.querySelector(SCREENS[ctx.space]);
    return [...(screen?.querySelectorAll(FILE_INPUT) || [])].find((i) => i.isConnected && !stale.has(i) && i.closest(".doc-drop")?.getClientRects().length) || null;
  }
  // File: the files are chosen at once (the tap is the browser's permission to open the picker), then the space's Files opens and
  // they go into its existing add flow (the documents block's confirm step), exactly as if chosen there.
  function addFile(ctx) {
    const input = Object.assign(root.document.createElement("input"), { type: "file", multiple: true, hidden: true });
    root.document.body.append(input);
    input.addEventListener("change", async () => {
      const files = input.files;
      input.remove();
      if (!files?.length) return;
      const target = href(ctx, "documents"), here = root.location.hash === target && current?.space === ctx.space && current?.id === ctx.id;
      // already on this space's Files: its own input as it is; otherwise only one drawn after the route changes
      const stale = new Set(here ? [] : root.document.querySelectorAll(FILE_INPUT));
      if (!here) root.location.hash = target;
      // The Files view can draw itself again as its reads come in: the files go to the input that is still there after a short quiet
      // spell, and are handed over again only if that input was replaced before its confirm step opened. Reading a file (a large
      // workbook) can take a while: while the input is still there the step is still opening, and nothing else is said.
      const moved = () => root.location.hash !== target;
      const gone = () => toast("The files weren't added: you moved to another place before its Files opened. Choose them again there.");
      const open = () => root.document.querySelector(SCREENS[ctx.space] + " .doc-confirm:not([hidden])");
      for (let tries = 0; tries < 4; tries++) {
        const drop = await settled(() => (moved() ? MOVED : liveInput(ctx, stale, target)));
        if (drop === MOVED || moved()) { if (!open()) gone(); return; }
        if (!drop) { if (!open()) toast("Files can't be added here just now."); return; }
        try { drop.files = files; } catch { toast("Choose the files again under Add files."); drop.closest(".doc-drop")?.scrollIntoView({ block: "center" }); return; }
        drop.dispatchEvent(new Event("change", { bubbles: true }));
        const box = drop.closest(".doc-add")?.querySelector(".doc-confirm");
        const result = await waitFor(() => (box?.isConnected && !box.hidden ? "open" : !drop.isConnected ? "replaced" : moved() ? "moved" : null), 60000);
        if (result === "open") { box.closest(".doc-add")?.scrollIntoView({ block: "nearest" }); return; }
        if (result === "moved" || moved()) { if (!open()) gone(); return; }
        if (result !== "replaced") { if (!open()) toast("Files can't be added here just now."); return; }
        stale.add(drop);   // replaced under it before its step opened: the next one drawn takes them
      }
      if (!open()) toast("Files can't be added here just now.");
    }, { once: true });
    input.addEventListener("cancel", () => input.remove(), { once: true });
    input.click();
  }

  // A quiet note at the bottom of the screen, gone after a few seconds (and read out once)
  function toast(text) {
    const d = root.document;
    let t = d.querySelector(".toast");
    if (!t) { t = d.createElement("p"); t.className = "toast"; t.setAttribute("role", "status"); d.body.append(t); }
    t.textContent = text; t.hidden = false;
    clearTimeout(t._timer); t._timer = setTimeout(() => { t.hidden = true; }, 4000);
  }

  // ---- the button and the sheet -----------------------------------------------------------------------------------------------
  const buttons = new Map();   // space -> the space header's button
  let current = null, sheet = null, opener = null;
  const el = (tag, attrs = {}, ...kids) => FP().el(tag, attrs, ...kids);
  const phone = () => root.matchMedia?.("(max-width: 800px)").matches;

  // The space's header gives its slot once; the button lives there (styled as a floating round button on a phone).
  function mount(slot, space) {
    if (!slot || buttons.has(space)) return buttons.get(space) || null;
    const b = el("button", { type: "button", class: "add-button", "aria-haspopup": "dialog", "aria-expanded": "false", hidden: true, "data-add-space": space },
      FP().icon("plus", 20), el("span", { class: "add-label" }, "Add"));
    b.addEventListener("click", () => (sheet && !sheet.hidden ? close() : FP()?.captureRing?.isOpen?.() ? FP().captureRing.close() : open(b)));
    slot.append(b);
    buttons.set(space, b);
    return b;
  }
  // The space now shown (or null to put the button away). The button shows only when there is something to add.
  function update(ctx) {
    current = ctx || null;
    for (const [space, b] of buttons) {
      const n = ctx && ctx.space === space ? registry.available(ctx).length : 0;
      b.hidden = !n;
      b.setAttribute("aria-label", "Add" + (ctx?.name ? " to " + ctx.name : ""));
    }
    if (sheet && !sheet.hidden) close(false);
    FP()?.captureRing?.close(false);
    watch();
  }
  // On a phone the round button floats over the bottom right. A sheet along the bottom (the map viewer's, a farm's What's due)
  // lifts it, so it never covers that sheet's controls; a sheet that takes most of the screen, or the phone's keyboard, tucks it
  // away until they go. Checked a few times a second while a button shows on a phone, and never otherwise.
  // (UI2: the group Overview's short map strip on a phone is not a sheet along the bottom: the button stays where it is over the page,
  // rather than climbing onto the strip's own controls; opened tall, the strip's controls lift it as any map's do)
  const SHEETS = ".rv-panel, .pa-sheet, #overview-rail:not([hidden]), #space-content:not([hidden]), .maplibregl-ctrl-bottom-right:not(#screen-group.has-needs:not(.map-open) #group-map .maplibregl-ctrl-bottom-right)";
  // panels that take the bottom of the screen while they are open: the button tucks away until they close (N2b's water quality
  // sites panel reaches 72% of a phone)
  const TUCK = ".events-form, .add-block-form, #layers-drawer:not([hidden]), .photo-card, .wqs-panel:not([hidden])";
  let watching = null, clicks = false;
  function settle() {
    const d = root.document, b = [...buttons.values()].find((x) => !x.hidden && x.getClientRects().length);
    if (!b || !phone()) { d.documentElement.style.setProperty("--add-lift", "0px"); d.body.classList.remove("add-tucked"); return; }
    const tabs = [...d.querySelectorAll(".space-tabs")].map((t) => t.getBoundingClientRect()).find((r) => r.height), floor = tabs ? tabs.top : root.innerHeight;
    let lift = 0, tuck = false;
    for (const s of d.querySelectorAll(SHEETS)) {
      const r = s.getBoundingClientRect();
      if (!r.height || r.top >= floor) continue;
      // a sheet along the bottom of what shows, or the map's own controls in its bottom right corner (its credit, its scale)
      if (s.classList.contains("maplibregl-ctrl-bottom-right") ? r.bottom < floor - 260 || !s.childElementCount : r.bottom < floor - 2) continue;
      const covered = floor - r.top + (s.classList.contains("maplibregl-ctrl-bottom-right") ? 4 : 0);
      if (covered > (floor * 0.5)) continue;   // a whole page (a client's Files): the button floats over it as over any page
      lift = Math.max(lift, covered);
    }
    // UI2: the group Overview's short map strip on a phone: the button rests on the strip's bottom right (over the map, its credit moved
    // to the left), never on the launcher or the cards' text; scrolled away, it goes back to the bottom of the screen
    const strip = d.querySelector("#screen-group.has-needs:not(.map-open) #group-map:not([hidden])");
    const sr = strip?.getBoundingClientRect();
    if (sr && sr.height > 120 && sr.bottom <= floor - 12 && sr.bottom - 12 - 52 >= Math.max(sr.top + 52, floor * 0.3)) lift = Math.max(lift, floor - sr.bottom + 12 - 16);
    const vv = root.visualViewport;
    if (vv && vv.height < root.innerHeight * 0.75) tuck = true;   // the keyboard is up
    if ([...d.querySelectorAll(TUCK)].some((f) => f.getClientRects().length)) tuck = true;   // a form being filled in, the Layers drawer, a photo or a sites panel open
    if (floor - lift - 88 < root.innerHeight * 0.3) tuck = true;
    d.documentElement.style.setProperty("--add-lift", Math.round(lift) + "px");
    d.body.classList.toggle("add-tucked", tuck);
  }
  function watch() {
    const on = [...buttons.values()].some((x) => !x.hidden) && phone();
    if (on && !watching) watching = setInterval(settle, 400);
    if (!clicks) {   // once: a tap that opens a form or a sheet, and a phone turned into a computer-sized window (or back)
      clicks = true; root.document.addEventListener("click", () => setTimeout(settle, 80), true); root.addEventListener("resize", watch);
    }
    if (!on && watching) { clearInterval(watching); watching = null; }
    settle();
  }
  function build() {
    sheet = el("div", { class: "add-sheet", hidden: true },
      el("div", { class: "add-backdrop", "data-add-close": "" }),
      el("div", { class: "add-panel", role: "dialog", "aria-modal": "true", "aria-labelledby": "add-title" },
        el("div", { class: "add-grip", "aria-hidden": "true" }),
        el("div", { class: "add-head" }, el("h2", { id: "add-title" }, "Add"), el("p", { class: "add-where", id: "add-where" })),
        el("ul", { class: "add-list", role: "list" }),
        el("button", { type: "button", class: "add-cancel", "data-add-close": "" }, "Cancel")));
    root.document.body.append(sheet);
    sheet.addEventListener("click", (e) => { if (e.target.closest("[data-add-close]")) close(); });
    sheet.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); return; }
      const items = [...sheet.querySelectorAll(".add-item, .add-cancel")].filter((n) => n.getClientRects().length);   // (Cancel shows on a phone only)
      const at = items.indexOf(root.document.activeElement);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); items[(at + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus(); }
      if (e.key === "Tab") {   // the focus stays in the sheet while it is open
        const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && root.document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && root.document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
    root.addEventListener("hashchange", () => { if (!sheet.hidden) close(false); });
    root.addEventListener("resize", () => { if (!sheet.hidden) place(); });
  }
  // On a computer the popover hangs directly under its button, right-aligned with it (never past either edge of the window), with a
  // small pointer to the button. It may sit over the page's own add control while it is open: it offers the same things.
  function place() {
    const panel = sheet.querySelector(".add-panel");
    if (phone() || !opener) { panel.style.top = panel.style.right = ""; panel.style.removeProperty("--add-pointer"); return; }
    const r = opener.getBoundingClientRect(), width = panel.getBoundingClientRect().width || 320;
    const right = Math.round(Math.min(Math.max(12, root.innerWidth - r.right), root.innerWidth - width - 12));
    panel.style.right = right + "px";
    panel.style.top = Math.round(r.bottom + 10) + "px";
    // the pointer sits under the button's middle
    panel.style.setProperty("--add-pointer", Math.round(root.innerWidth - right - (r.left + r.width / 2)) + "px");
  }
  // CAP1: on a phone, in a group (where the captures are), the + opens the ring of options around it (capture-ring.js), built from the
  // same available(ctx); its More opens this sheet. Where the ring can't fit (a short window, the + lifted by a map's sheet), and in a
  // farm (one action, a file), the sheet opens as before.
  function open(button) {
    const ctx = current, items = registry.available(ctx);
    if (!items.length) return;
    if (phone() && ctx.space === "group" && FP()?.captureRing?.open({ button, ctx, available: items, more: () => openSheet(button) })) return;
    openSheet(button);
  }
  function openSheet(button) {
    const ctx = current, items = registry.available(ctx);
    if (!items.length) return;
    if (!sheet) build();
    opener = button;
    sheet.querySelector("#add-where").textContent = ctx.name ? "to " + ctx.name : "";
    sheet.querySelector(".add-list").replaceChildren(...items.map((a) => el("li", {},
      el("button", { type: "button", class: "add-item", "data-add-action": a.id, onclick: () => { close(false); a.run(ctx); } },
        el("span", { class: "add-item-icon" }, FP().icon(a.icon, 22)),
        el("span", { class: "add-item-text" }, el("b", {}, a.label), a.hint ? el("small", {}, a.hint) : null)))),
      // CAP1: on a phone, in a group, the add menu's own choice sits here, after the actions (never among them in the menu itself)
      ...(phone() && ctx.space === "group" && FP()?.captureRing ? [el("li", {}, el("button", { type: "button", class: "add-item add-choose", "data-add-choose": "",
        onclick: () => { close(false); FP().captureRing.edit(button, ctx, items); } },
        el("span", { class: "add-item-icon" }, FP().icon("create", 22)), el("span", { class: "add-item-text" }, el("b", {}, "Choose what's in the add menu"), el("small", {}, "On this phone: which, and in what order"))))] : []));
    sheet.classList.toggle("is-phone", !!phone());
    sheet.hidden = false;
    place();
    button.setAttribute("aria-expanded", "true");
    root.document.body.classList.add("add-open");
    sheet.querySelector(".add-item")?.focus();
  }
  function close(refocus = true) {
    if (!sheet || sheet.hidden) return;
    sheet.hidden = true;
    root.document.body.classList.remove("add-open");
    opener?.setAttribute("aria-expanded", "false");
    if (refocus && opener && !opener.hidden) opener.focus();
  }

  return { createRegistry, registry, register: registry.register, available: registry.available, mount, update, open, openSheet, close, toast, mayAddFile, mayAddEvent, mayAddPeople, mayCapture,
    get context() { return current; }, buttons: () => [...buttons.values()] };
});
