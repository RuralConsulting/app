// CAP1: the add menu on a phone. Tapping the round + opens a short list rising from it over a dimmed backdrop: the Add registry's
// actions this person may use here (add.js, in the person's order), and "More" (the full Add list) last when not all fit. PH1: plain
// rows in one outline, Take a photo first (the owner, 13 Nov 2026: "primarily take a photo"). It is a
// menu: the focus moves into it (to Take a photo, the first), arrow keys and Tab move through the options, Escape or a tap outside
// closes it and the focus goes back to the +. Nothing moves when the person asks for reduced motion. "Choose what's in the add menu"
// (edit(), kept per person on the device) is in the More list and in Records' menu. What it holds and where: capture-ring-model.js.
(function (root) {
  const FP = root.FP;
  const M = () => FP.captureRingModel;
  const el = (...a) => FP.el(...a);
  let box = null, opener = null, ctxNow = null, availableNow = [], moreNow = null;
  const storage = () => { try { return root.localStorage; } catch { return null; } };
  const user = () => FP.captures?.userId?.() || null;

  // The window's top for the list: below the place's header (the list never covers it), else the window's top.
  function ceiling() {
    const h = [...root.document.querySelectorAll(".space-head, .group-head")].map((t) => t.getBoundingClientRect()).find((x) => x.height && x.bottom > 0);
    return h ? h.bottom : 0;
  }

  // Opens the menu for `button` (the round +). Returns false, drawing nothing, when it cannot fit here (the caller opens the list).
  // PH1: a list rising from the +: one thin outline around the set, plain rows (a small leading icon, then the words), Take a photo
  // first and the primary row (its icon in a filled ink circle), a hairline between groups; read and moved through top to bottom.
  function open({ button, ctx, available, more }) {
    close(false);
    const slots = M().ring(available, M().readPrefs(storage(), user()));
    const groups = FP.phoneModel.rows(slots), ordered = groups.flat();
    const r = button.getBoundingClientRect();
    if (!r.width) return false;
    const rows = M().layout(ordered.length, groups);
    const box0 = M().place(rows, { width: root.innerWidth, plus: { top: r.top, right: r.right }, top: ceiling() });
    if (!box0) return false;
    opener = button; ctxNow = ctx; availableNow = available; moreNow = more;
    FP.locate?.warm?.();   // PH1: a position ready for a photo, when the person has already allowed it (never a prompt)
    const name = ctx?.name ? "Add to " + ctx.name : "Add";
    const items = ordered.map((s, i) => {
      const a = s.kind === "action" ? s.action : null, primary = !!a && a.id === M().PRIMARY;
      const label = FP.phoneModel.rowWords(a);
      const b = el("button", { type: "button", role: "menuitem", class: "ring-item" + (primary ? " ring-primary" : ""), id: "ring-" + (a ? a.id : s.kind), "data-ring": a ? a.id : s.kind,
        "aria-label": a ? label + (a.hint ? ": " + a.hint : "") : "More: everything you can add here", tabindex: i ? "-1" : "0" },
        el("span", { class: "ring-dot", "aria-hidden": "true" }, FP.icon(a ? a.icon : "more", primary ? 18 : 20)), el("span", { class: "ring-word", "aria-hidden": "true" }, label));
      b.addEventListener("click", () => choose(s));
      return b;
    });
    // the rows in their groups, a hairline between groups
    let at = 0;
    const parts = groups.flatMap((g, gi) => { const part = items.slice(at, at + g.length); at += g.length; return gi ? [el("div", { class: "ring-sep", role: "separator" }), ...part] : part; });
    const shut = el("button", { type: "button", class: "ring-close", "aria-label": "Close", style: "left:" + Math.round(r.left + r.width / 2) + "px;top:" + Math.round(r.top + r.height / 2) + "px", tabindex: "-1" }, FP.icon("close", 22));
    shut.addEventListener("click", () => close());
    const menu = el("div", { class: "ring-menu ring-list", role: "menu", id: "add-ring-menu", "aria-label": name, "aria-orientation": "vertical",
      style: "left:" + box0.left + "px;top:" + box0.top + "px;width:" + box0.width + "px" }, ...parts);
    box = el("div", { class: "ring", id: "add-ring" }, el("div", { class: "ring-backdrop", "data-ring-close": "" }), shut, menu);
    box.addEventListener("click", (e) => { if (e.target.closest("[data-ring-close]")) close(); });
    box.addEventListener("keydown", keys);
    root.document.body.append(box);
    root.document.body.classList.add("add-open", "ring-open");
    button.setAttribute("aria-haspopup", "menu");
    button.setAttribute("aria-expanded", "true");
    button.setAttribute("aria-controls", "add-ring-menu");
    items[0]?.focus();
    return true;
  }
  function keys(e) {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); return; }
    const items = [...box.querySelectorAll(".ring-item")], at = items.indexOf(root.document.activeElement);
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "Tab"].includes(e.key)) return;
    e.preventDefault();
    const next = M().step(e.key, at, items.length, e.shiftKey);
    items.forEach((b, i) => b.setAttribute("tabindex", i === next ? "0" : "-1"));
    items[next]?.focus();
  }
  function choose(s) {
    const ctx = ctxNow, more = moreNow, button = opener, available = availableNow;
    close(false);
    if (s.kind === "action") s.action.run(ctx);
    else if (s.kind === "more") more?.();
  }
  function close(refocus = true) {
    if (!box) return;
    box.remove(); box = null;
    root.document.body.classList.remove("add-open", "ring-open");
    if (opener) { opener.setAttribute("aria-expanded", "false"); opener.setAttribute("aria-haspopup", "dialog"); opener.removeAttribute("aria-controls"); }
    if (refocus && opener && !opener.hidden) opener.focus();
  }

  // ---- what is in the add menu, and in what order (kept on this device for this person) -----------------------------------------------
  function edit(button, ctx, available) {
    let prefs = M().readPrefs(storage(), user());
    const saved = el("p", { class: "ring-edit-note", role: "status" });
    const list = el("ul", { class: "ring-edit-list", role: "list" });
    function draw(focusId, focusWhat) {
      const all = M().arrange(available, prefs);
      list.replaceChildren(...all.map((x, i) => {
        const a = x.action, id = "ring-on-" + a.id;
        const pinned = a.id === M().PRIMARY;   // PH1: Take a photo is always first and always in the menu
        const tick = el("input", { type: "checkbox", id, checked: x.on, "data-ring-on": a.id, disabled: pinned });
        tick.addEventListener("change", () => { prefs = M().toggle(available, prefs, a.id, tick.checked); keep(); draw(a.id, "on"); });
        const up = el("button", { type: "button", class: "ring-move", "data-ring-up": a.id, "aria-label": "Move " + a.label + " up", disabled: pinned || i === 0 || all[i - 1]?.action.id === M().PRIMARY }, FP.icon("up", 18));
        const down = el("button", { type: "button", class: "ring-move", "data-ring-down": a.id, "aria-label": "Move " + a.label + " down", disabled: pinned || i === all.length - 1 }, FP.icon("down", 18));
        up.addEventListener("click", () => { prefs = M().move(available, prefs, a.id, -1); keep(); draw(a.id, i - 1 === 0 ? "down" : "up"); });
        down.addEventListener("click", () => { prefs = M().move(available, prefs, a.id, 1); keep(); draw(a.id, i + 1 === all.length - 1 ? "up" : "down"); });
        return el("li", { class: "ring-edit-row", "data-ring-row": a.id },
          el("label", { for: id, class: "ring-edit-label" }, tick, el("span", { class: "add-item-icon", "aria-hidden": "true" }, FP.icon(a.icon, 20)), el("span", {}, a.label)),
          el("span", { class: "ring-edit-moves" }, up, down));
      }));
      if (focusId) list.querySelector(focusWhat === "on" ? '[data-ring-on="' + focusId + '"]' : '[data-ring-' + focusWhat + '="' + focusId + '"]')?.focus();
    }
    function keep() { saved.textContent = M().writePrefs(storage(), user(), prefs) ? "Kept on this phone." : "This browser won't keep the choice after it closes."; }
    const reset = el("button", { type: "button", class: "link ring-edit-reset" }, "Back to the usual order");
    reset.addEventListener("click", () => { M().clearPrefs(storage(), user()); prefs = null; saved.textContent = "Back to the usual order."; draw(); });
    FP.sheet.open({ opener: button, title: "Your add menu", className: "ring-edit",
      body: () => { draw(); return [el("p", { class: "ring-edit-note ring-edit-help" }, "Tick what is in the add menu on this phone and move it up or down. Take a photo is always first. Five fit; More lists everything."), list, el("div", { class: "ring-edit-foot" }, reset, saved)]; } });
  }

  root.addEventListener("hashchange", () => close(false));
  root.addEventListener("resize", () => close(false));
  FP.captureRing = { open, close, edit, isOpen: () => !!box };
})(window);
