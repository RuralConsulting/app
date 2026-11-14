// UI2: a space's sections (its tabs). On a phone at most five sit in the tab bar and the rest are under More, which opens a sheet
// (sheet.js) listing them; on a computer the segmented control holds the same five and the rest go in a More menu at its end. Which sections
// a person may open is decided before this (simple-view.js for a client, the role rules in group-space.js and farm-space.js); this
// file only arranges what it is given, in the order given. The header's second line is the place's kind; the person's role is said
// in the account menu ("You are an admin of this group") and, on a computer, also in the header when it fits.
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else { root.FP = root.FP || {}; root.FP.spaceNav = api; }
})(typeof window === "undefined" ? globalThis : window, function (root) {
  // (a computer shows the same five and More: Create and Manage are staff tools, under More on every screen, as docs/PRODUCT.md)
  const PHONE_MAX = 5, DESKTOP_MAX = 5;
  // HM1 (the owner, 14 Nov 2026): a phone's bar is the same five buttons for everyone, Home, Maps, People, Files and More, each an
  // even share of the bar. Every other section is under More, Events first (and Search second, in a group: render below), then the
  // rest in the space's own order; nothing is removed, so whatever was in the bar is at most two taps away. A section the person may
  // not open (People, for a group's plain members) is simply not there: its button is not replaced by another. A computer keeps the
  // space's own order and its five (DESKTOP_MAX).
  const PHONE_BAR = ["home", "maps", "people", "documents"];
  const PHONE_ORDER = [...PHONE_BAR, "events"];
  function phoneOrder(tabs) {
    const rank = (t) => { const i = PHONE_ORDER.indexOf(t.key); return i < 0 ? PHONE_ORDER.length : i; };
    return tabs.map((t, i) => ({ t, i })).sort((a, b) => rank(a.t) - rank(b.t) || a.i - b.i).map((x) => x.t);
  }
  const norm = (t) => (Array.isArray(t) ? { key: t[0], label: t[1] } : { ...t });

  // tabs: [[key, label]] or [{ key, label }], in order. Returns { shown, more } (each [{ key, label }]); more is empty when every
  // section fits. On a computer at most `max` sections are shown, and More holds the rest. On a phone (HM1) the bar holds PHONE_BAR's
  // sections only, whatever `max` (WQV1's Water quality is under More with the rest), and More holds the others, Events first.
  function arrange(tabs, max = PHONE_MAX, { phone = false } = {}) {
    let all = (Array.isArray(tabs) ? tabs : []).map(norm).filter((t) => t.key);
    if (phone) {
      all = phoneOrder(all);
      const shown = all.filter((t) => PHONE_BAR.includes(t.key)).slice(0, Math.max(0, max - 1));
      return { shown, more: all.filter((t) => !shown.includes(t)) };
    }
    if (all.length <= max) return { shown: all, more: [] };
    return { shown: all.slice(0, max), more: all.slice(max) };
  }
  // Which button is current: the section's own tab, or More when the section is under it.
  const currentOf = (arranged, view) => (arranged.shown.some((t) => t.key === view) ? view : arranged.more.some((t) => t.key === view) ? "more" : null);

  // The header's lines. kind: "Catchment group", "Sub-group of …", "Farm". role: the person's role here (or none).
  // The second line on a phone is the kind alone; a computer adds the role when it is known. The role's sentence is for the account menu.
  const article = (w) => (/^[aeiou]/i.test(w) ? "an " : "a ");
  function roleLine(role, space = "group") {
    const r = String(role || "").trim();
    return r ? "You are " + article(r) + r + " of this " + (space === "farm" ? "farm" : "group") : "";
  }
  function headerLines({ kind, role = null, phone = false } = {}) {
    const k = String(kind || "").trim(), r = String(role || "").trim();
    return { kind: k, second: phone || !r ? k : k + " · you are " + article(r) + r, menu: roleLine(r) };
  }

  // ---- in the browser ----------------------------------------------------------------------------------------------------------
  const drawn = new Map();   // nav element -> its last arguments (drawn again when the window crosses the phone width)
  const isPhone = () => !!root.matchMedia?.("(max-width: 800px)").matches;
  // More's rows on a phone (HM1): the sections under More in order (Events first), with Search as the second row when the space has
  // one (first when Events is not there). [{ key, label, icon, href } | { key: "search", label: "Search", icon: "search", search: true }]
  function moreRows(more, { search = false } = {}) {
    const rows = (Array.isArray(more) ? more : []).map(norm).filter((t) => t.key);
    if (!search) return rows;
    const at = rows[0]?.key === "events" ? 1 : 0, find = { key: "search", label: "Search", icon: "search", search: true };
    return [...rows.slice(0, at), find, ...rows.slice(at)];
  }
  // nav: the <nav> element; tabs: [{ key, label, href, icon, badge?: () => Node|null }]; view: the section shown now.
  // PH2 (the owner, 13 Nov 2026: "all navigation down via buttons at bottom"): on a phone the bar floats, rounded, icons only (each
  // with its name for a screen reader, the current one marked). HM1 (the owner, 14 Nov 2026): Home, Maps, People, Files and More, each
  // an even share; More opens the rest as a plain list, Events and Search first (opts.search: run when Search is tapped, given the
  // More button). Search is also the box on a group's Home sheet (phone-area.js).
  function render(nav, tabs, view, opts = {}) {
    const FP = root.FP, el = (...a) => FP.el(...a);
    drawn.set(nav, { tabs, view, opts });
    const phone = isPhone();
    const arranged = phone ? arrange(tabs, PHONE_MAX, { phone: true }) : arrange(tabs, DESKTOP_MAX), cur = currentOf(arranged, view);
    const byKey = new Map(tabs.map((t) => [t.key, t]));
    const link = (t) => el("a", { href: t.href, class: "group-tab", "data-tab": t.key, ...(t.key === view ? { "aria-current": "page" } : {}) },
      t.icon ? FP.icon(t.icon) : null, el("span", {}, t.label), t.badge?.() || null);
    const nodes = arranged.shown.map((t) => link(byKey.get(t.key)));
    const rows = moreRows(arranged.more, { search: !!opts.search && phone });
    if (rows.length) {
      const hidden = arranged.more.map((t) => byKey.get(t.key)), dot = hidden.some((t) => t.badge?.());
      const more = el("button", { type: "button", class: "group-tab nav-more", "data-tab": "more", "aria-haspopup": "dialog", "aria-expanded": "false", ...(cur === "more" ? { "aria-current": "page" } : {}) },
        FP.icon("more"), el("span", {}, "More"), dot ? el("span", { class: "nav-dot", "aria-label": "Something to look at" }) : null);
      more.addEventListener("click", () => FP.sheet.menu(more, "More", rows.map((r) => {
        if (r.search) return { label: "Search", icon: "search", action: "search", run: () => opts.search(more) };
        const t = byKey.get(r.key);
        return { label: t.label, icon: t.icon, href: t.href, current: t.key === view, badge: t.badge?.() || null };
      })));
      nodes.push(more);
    }
    nav.replaceChildren(...nodes);
    nav.dataset.count = String(nodes.length);
  }
  const refresh = (nav) => { const a = nav && drawn.get(nav); if (a && nav.isConnected) render(nav, a.tabs, a.view, a.opts); };
  if (root.matchMedia && root.document) root.matchMedia("(max-width: 800px)").addEventListener?.("change", () => { for (const nav of drawn.keys()) refresh(nav); });

  return { PHONE_MAX, DESKTOP_MAX, PHONE_BAR, PHONE_ORDER, phoneOrder, arrange, moreRows, currentOf, roleLine, headerLines, render, refresh };
});
