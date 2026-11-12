// UI2: one sheet for the small choices a screen tucks away (the More sections, People's Filter, a "…" menu of quieter actions).
// The same look and manners as Add's sheet (add.js, ui.css): a sheet from the bottom on a phone, a popover under its button on a
// computer; the focus stays inside while it is open, Escape or the backdrop closes it, and the focus goes back to the button.
// While one is open the round + is tucked away (body.sheet-open).
//
//   FP.sheet.open({ opener, title, where?, body(close) -> nodes, className? })   a sheet with anything in it
//   FP.sheet.menu(opener, title, [{ label, hint?, icon?, action?, run() }])      a list of actions
//   FP.sheet.close()
(function (root) {
  const FP = root.FP;
  const el = (...a) => FP.el(...a);
  const phone = () => root.matchMedia?.("(max-width: 800px)").matches;
  let current = null;   // { node, opener, onClose }

  const focusables = (n) => [...n.querySelectorAll("a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex='-1'])")]
    .filter((x) => x.getClientRects().length);

  function place(node, opener) {
    const panel = node.querySelector(".add-panel");
    if (phone() || !opener) { panel.style.top = panel.style.right = panel.style.left = ""; return; }
    const r = opener.getBoundingClientRect(), width = panel.getBoundingClientRect().width || 320;
    // under the button, right-aligned with it, never past either edge of the window
    const right = Math.round(Math.min(Math.max(12, root.innerWidth - r.right), root.innerWidth - width - 12));
    panel.style.right = right + "px";
    panel.style.top = Math.round(r.bottom + 10) + "px";
    panel.style.setProperty("--add-pointer", Math.round(root.innerWidth - right - (r.left + r.width / 2)) + "px");
  }

  function close(refocus = true) {
    if (!current) return;
    const { node, opener, onClose } = current;
    current = null;
    node.remove();
    root.document.body.classList.remove("sheet-open");
    opener?.setAttribute("aria-expanded", "false");
    onClose?.();
    if (refocus && opener?.isConnected) opener.focus();
  }

  function open({ opener = null, title, where = "", body, className = "", onClose = null }) {
    close(false);
    const id = "fp-sheet-title-" + Math.random().toString(36).slice(2, 8);
    const panel = el("div", { class: "add-panel fp-panel", role: "dialog", "aria-modal": "true", "aria-labelledby": id },
      el("div", { class: "add-grip", "aria-hidden": "true" }),
      el("div", { class: "add-head" }, el("h2", { id }, title), where ? el("p", { class: "add-where" }, where) : null));
    const node = el("div", { class: "add-sheet fp-sheet " + className }, el("div", { class: "add-backdrop", "data-sheet-close": "" }), panel);
    current = { node, opener, onClose };
    const kids = body(() => close());
    panel.append(...[].concat(kids).filter(Boolean), el("button", { type: "button", class: "add-cancel", "data-sheet-close": "" }, "Done"));
    root.document.body.append(node);
    root.document.body.classList.add("sheet-open");
    opener?.setAttribute("aria-expanded", "true");
    node.addEventListener("click", (e) => { if (e.target.closest("[data-sheet-close]")) close(); });
    node.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); return; }
      if (e.key !== "Tab") return;
      const items = focusables(panel), first = items[0], last = items[items.length - 1];
      if (!items.length) return;
      if (e.shiftKey && root.document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && root.document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    place(node, opener);
    (panel.querySelector("[autofocus]") || focusables(panel)[0])?.focus();
    return node;
  }

  // A list of actions, each one tap
  function menu(opener, title, items, where = "") {
    return open({ opener, title, where, className: "fp-menu", body: (done) => el("ul", { class: "add-list", role: "list" }, ...items.map((it) => el("li", {},
      el(it.href ? "a" : "button", { ...(it.href ? { href: it.href } : { type: "button" }), class: "add-item fp-menu-item", ...(it.action ? { "data-action": it.action } : {}), ...(it.current ? { "aria-current": "page" } : {}),
        onclick: () => { done(); it.run?.(); } },
        it.icon ? el("span", { class: "add-item-icon" }, FP.icon(it.icon, 20)) : null,
        el("span", { class: "add-item-text" }, el("b", {}, it.label), it.hint ? el("small", {}, it.hint) : null),
        it.badge || null)))) });
  }

  // A round "…" button that opens a menu
  function moreButton(label, items, title = label) {
    const b = el("button", { type: "button", class: "more-button", "aria-haspopup": "dialog", "aria-expanded": "false", "aria-label": label, title: label },
      el("span", { "aria-hidden": "true" }, "•••"));
    b.addEventListener("click", () => (current?.opener === b ? close() : menu(b, title, typeof items === "function" ? items() : items)));
    return b;
  }

  root.addEventListener("hashchange", () => close(false));
  // Escape closes it even when the focus has left it (a choice inside it redrew its contents)
  root.document.addEventListener("keydown", (e) => { if (e.key === "Escape" && current && !e.defaultPrevented) { e.preventDefault(); close(); } });
  root.addEventListener("resize", () => { if (current) place(current.node, current.opener); });
  FP.sheet = { open, menu, close, moreButton, isOpen: () => !!current };
})(window);
