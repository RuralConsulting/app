// UI1: the account menu: who is signed in, Change password, Operations (staff), Privacy and terms, Sign out, behind one round
// button in the home panel and the group's header (the farm header's own menu, farm-space.js, works the same way). Opens on a
// click or Enter, closes on Escape, a click outside, a choice or a change of page, and gives the focus back to its button.
// Change password and Sign out are handled once for every copy (main.js, by their classes).
(function (root) {
  const FP = root.FP;
  const menus = [];
  function setOpen(m, open, refocus) {
    m.menu.classList.toggle("open", open);
    m.button.setAttribute("aria-expanded", String(open));
    if (open) m.menu.querySelector("a:not([hidden]), button:not([hidden])")?.focus();
    else if (refocus) m.button.focus();
  }
  function wire(button, menu) {
    if (!button || !menu || menus.some((m) => m.button === button)) return;
    const m = { button, menu };
    menus.push(m);
    button.addEventListener("click", () => setOpen(m, !menu.classList.contains("open"), false));
    menu.addEventListener("click", (e) => { if (e.target.closest("a, button")) setOpen(m, false, false); });
  }
  root.document.addEventListener("click", (e) => { for (const m of menus) if (m.menu.classList.contains("open") && !m.menu.contains(e.target) && !m.button.contains(e.target)) setOpen(m, false, false); });
  root.document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    for (const m of menus) if (m.menu.classList.contains("open")) { setOpen(m, false, true); e.preventDefault(); }
  });
  root.addEventListener("hashchange", () => { for (const m of menus) setOpen(m, false, false); });
  // The round button's letters: the person's initials (or the first letter of their email)
  function initials(user) {
    const name = String(user?.user_metadata?.display_name || "").trim();
    if (name) return name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
    return String(user?.email || "?").slice(0, 1).toUpperCase();
  }
  FP.accountMenu = { wire, initials, closeAll: () => { for (const m of menus) setOpen(m, false, false); } };
})(window);
