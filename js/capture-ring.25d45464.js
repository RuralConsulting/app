// CAP1: the add menu on a phone. Tapping the round + opens a short, even column of options rising straight up from it over a dimmed
// backdrop: the Add registry's actions this person may use here (add.js, in the person's order, the first nearest the +), each a small
// round button on the +'s centre line with its words to its left, and "More" (the full Add list) on top when not all fit. It is a
// menu: the focus moves into it (to the option nearest the +), arrow keys and Tab move through the options, Escape or a tap outside
// closes it and the focus goes back to the +. Nothing moves when the person asks for reduced motion. "Choose what's in the add menu"
// (edit(), kept per person on the device) is in the More list and in Records' menu. What it holds and where: capture-ring-model.js.
(function (root) {
  const FP = root.FP;
  const M = () => FP.captureRingModel;
  const el = (...a) => FP.el(...a);
  let box = null, opener = null, ctxNow = null, availableNow = [], moreNow = null;
  const storage = () => { try { return root.localStorage; } catch { return null; } };
  const user = () => FP.captures?.userId?.() || null;

  // The tab bar's top (the ring never reaches below it), or the window's foot when there is none.
  function floor() {
    const r = [...root.document.querySelectorAll(".space-tabs")].map((t) => t.getBoundingClientRect()).find((x) => x.height && x.top < root.innerHeight);
    return r ? r.top : root.innerHeight;
  }

  // Opens the menu for `button` (the round +). Returns false, drawing nothing, when it cannot fit here (the caller opens the list).
  function open({ button, ctx, available, more }) {
    close(false);
    const slots = M().ring(available, M().readPrefs(storage(), user()));
    const r = button.getBoundingClientRect();
    if (!r.width) return false;
    const plus = { x: r.left + r.width / 2, y: r.top + r.height / 2 }, pos = M().layout(slots.length);
    if (!M().fits(pos, { width: root.innerWidth, plus, floor: floor() })) return false;
    opener = button; ctxNow = ctx; availableNow = available; moreNow = more;
    const name = ctx?.name ? "Add to " + ctx.name : "Add";
    const items = slots.map((s, i) => {
      const a = s.kind === "action" ? s.action : null;
      const label = a ? a.label : "More";
      // its right edge 22 px past the +'s centre line, so the round button sits on that line and the words run to its left
      const b = el("button", { type: "button", role: "menuitem", class: "ring-item", id: "ring-" + (a ? a.id : s.kind), "data-ring": a ? a.id : s.kind,
        "aria-label": a ? label + (a.hint ? ": " + a.hint : "") : "More: everything you can add here", tabindex: i ? "-1" : "0",
        style: "left:" + Math.round(plus.x + pos[i].dx + M().SIZE / 2) + "px;top:" + Math.round(plus.y + pos[i].dy) + "px;--ring-i:" + i },
        el("span", { class: "ring-word", "aria-hidden": "true" }, label), el("span", { class: "ring-dot" }, FP.icon(a ? a.icon : "more", 20)));
      b.addEventListener("click", () => choose(s));
      return b;
    });
    const shut = el("button", { type: "button", class: "ring-close", "aria-label": "Close", style: "left:" + Math.round(plus.x) + "px;top:" + Math.round(plus.y) + "px", tabindex: "-1" }, FP.icon("close", 22));
    shut.addEventListener("click", () => close());
    // (read and moved through top to bottom, as it is seen; the focus starts on the option nearest the +, the last)
    const menu = el("div", { class: "ring-menu", role: "menu", id: "add-ring-menu", "aria-label": name, "aria-orientation": "vertical" }, ...[...items].reverse());
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
        const tick = el("input", { type: "checkbox", id, checked: x.on, "data-ring-on": a.id });
        tick.addEventListener("change", () => { prefs = M().toggle(available, prefs, a.id, tick.checked); keep(); draw(a.id, "on"); });
        const up = el("button", { type: "button", class: "ring-move", "data-ring-up": a.id, "aria-label": "Move " + a.label + " up", disabled: i === 0 }, FP.icon("up", 18));
        const down = el("button", { type: "button", class: "ring-move", "data-ring-down": a.id, "aria-label": "Move " + a.label + " down", disabled: i === all.length - 1 }, FP.icon("down", 18));
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
      body: () => { draw(); return [el("p", { class: "ring-edit-note ring-edit-help" }, "Tick what is in the add menu on this phone and move it up or down: the first is nearest the +. Five fit; More lists everything."), list, el("div", { class: "ring-edit-foot" }, reset, saved)]; } });
  }

  root.addEventListener("hashchange", () => close(false));
  root.addEventListener("resize", () => close(false));
  FP.captureRing = { open, close, edit, isOpen: () => !!box };
})(window);
