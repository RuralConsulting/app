// ST1 (the owner, 16 Nov 2026, showing the landing page of the firm's older maps site: "coming around to thinking this is a better
// load page for rcl staff"): RCL staff open on a calm LIST of the places they can open, list-first like Attio, with the map one tap
// away. Everyone else keeps Places as it is (home.js: the map with its sheet).
//
// Who: RCL staff only, by the app's own staff check (ops.js isStaff: profiles.is_staff, read at start-up). Not staff, or not known
// to be staff, is today's Places, unchanged. Nothing here decides what anyone may read: the list is the places start-up already read
// (main.js: the farms and groups, under row-level security), the same ones Places shows.
// Where: the bare address (so sign-in) and "#/places" ("All places") for staff; "#/places/map" is today's Places map, reached from
// the list (a client's simple view does not list that address: clients keep Places at "#/places", unchanged).
// The list: a small row of tools (Map, the one primary action, and Operations, the staff page the account menu already offers), a
// search box once the list is longer than a screen, then the person's recent places (kept in this browser, per person), then the
// rest A to Z: groups (each followed by its sub-groups, as Places' list has them), then farms. Each row: the name, one quiet line
// (what it is, and the group a farm belongs to or its region, from what start-up read) and a chevron. Never a person's name or
// contact details, never a title's owners: those are not in what the list is given.
// Reads: none of its own beyond the parents' names Places also reads (home.js readParents: only for a sub-group whose parent group
// the person is not in, and none otherwise). The map's outlines are read only when the map is opened.
(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const api = factory(root, node ? require("./home-model.js") : null);
  if (node) module.exports = api; else { root.FP = root.FP || {}; root.FP.staffHome = api; }
})(typeof window === "undefined" ? globalThis : window, function (root, nodeHome) {
  const H = () => nodeHome || root.FP.homeModel;

  // ---- the pure parts (tests/app/st1-staff-home.test.cjs) ------------------------------------------------------------------------
  // Which addresses open the list: staff only, on the bare address, "#/places", or an address the router falls back from (main.js
  // calls this only where Places would show). "#/places/map" is always the map.
  const MAP = "#/places/map";
  const opensList = (hash, staff) => staff === true && hash !== MAP;

  // Recent places, per person, in this browser (localStorage; the caller wraps every read and write). Each entry "farm:<id>" or
  // "group:<id>", newest first, at most KEEP kept and SHOWN shown.
  const KEEP = 12, SHOWN = 5;
  const recentKey = (personId) => "fp-recent-places:" + String(personId || "anyone");
  function recentFrom(stored) {
    let v = stored;
    if (typeof v === "string") { try { v = JSON.parse(v); } catch { return []; } }
    if (!Array.isArray(v)) return [];
    const out = [];
    for (const k of v) if (typeof k === "string" && /^(farm|group):[\w-]{1,64}$/.test(k) && !out.includes(k)) out.push(k);
    return out.slice(0, KEEP);
  }
  const remember = (stored, kind, id) => (kind === "farm" || kind === "group") && id ? [kind + ":" + id, ...recentFrom(stored).filter((k) => k !== kind + ":" + id)].slice(0, KEEP) : recentFrom(stored);

  const plural = (n, one, many) => n + " " + (n === 1 ? one : many);
  const titleCase = (s) => String(s || "").replace(/[_-]+/g, " ").trim().replace(/\b\p{L}/gu, (c) => c.toUpperCase());
  const byName = (a, b) => String(a.name || "").localeCompare(String(b.name || ""), "en-NZ", { sensitivity: "base" }) || String(a.id).localeCompare(String(b.id));
  // The rows: { recent, groups, farms }, each row { key, kind ("farm" | "group" | "subgroup"), id, name, line, href }. A place in
  // recent is not repeated below it. farms and groups as main.js read them (farms: id, name, region, org_id; groups: id, name, slug,
  // parent_org_id, role); parents: id -> name, for parents the person is not in (home.js readParents).
  function rows(farms, groups, { parents = {}, recent = [] } = {}) {
    const list = (v) => (Array.isArray(v) ? v : []);
    const places = H().places(list(farms), list(groups), parents);
    const groupName = new Map(list(groups).map((g) => [g.id, g.name]));
    const subs = new Map();
    for (const g of list(groups)) if (g.parent_org_id && groupName.has(g.parent_org_id)) subs.set(g.parent_org_id, (subs.get(g.parent_org_id) || 0) + 1);
    const farmOf = new Map(list(farms).map((f) => [f.id, f]));
    const line = (p) => {
      if (p.kind === "farm") { const f = farmOf.get(p.id), where = (f?.org_id && groupName.get(f.org_id)) || titleCase(f?.region); return "Farm" + (where ? " · " + where : ""); }
      if (p.kind === "subgroup") return H().kindLabel(p);
      return "Catchment group" + (subs.get(p.id) ? " · " + plural(subs.get(p.id), "sub-group", "sub-groups") : "");
    };
    const row = (p, i) => ({ key: (p.kind === "farm" ? "farm:" : "group:") + p.id, kind: p.kind, id: p.id, name: p.name, line: line(p), href: H().openHref(p), at: i });
    const all = places.map(row), byKey = new Map(all.map((r) => [r.key, r]));
    const recentRows = recentFrom(recent).map((k) => byKey.get(k)).filter(Boolean).slice(0, SHOWN);
    const seen = new Set(recentRows.map((r) => r.key));
    return {
      recent: recentRows,
      groups: all.filter((r) => r.kind !== "farm" && !seen.has(r.key)),   // (in Places' order: groups A to Z, each followed by its sub-groups)
      farms: all.filter((r) => r.kind === "farm" && !seen.has(r.key)).sort(byName),
      count: all.length,
    };
  }
  // The search: every place (recent ones too) whose name or quiet line holds every word typed, any case, with or without macrons; in
  // the list's own order (groups, then farms). The quiet line counts, so a group's name finds its farms.
  function filter(r, query) {
    const words = H().fold(query).split(/\s+/).filter(Boolean);
    if (!words.length) return r;
    const hit = (x) => { const hay = H().fold(x.name + " " + x.line); return words.every((w) => hay.includes(w)); };
    const both = [...r.recent, ...r.groups, ...r.farms];
    return { recent: [], groups: both.filter((x) => x.kind !== "farm" && hit(x)).sort((a, b) => a.at - b.at), farms: both.filter((x) => x.kind === "farm" && hit(x)).sort(byName), count: r.count };
  }
  // The search box shows once the list is longer than a screen: its rows (48 px each, DN1) and the page's own parts above and between
  // them (the title, the tools and the section headings) against the screen's height.
  const ROW = 49, CHROME = 220;
  const searchShown = (count, height) => count * ROW + CHROME > (Number(height) || 0);

  // ---- in the browser --------------------------------------------------------------------------------------------------------
  const store = {
    get(k) { try { return root.localStorage?.getItem(k) ?? null; } catch { return null; } },
    set(k, v) { try { root.localStorage?.setItem(k, v); } catch { /* kept for this visit only */ } },
  };
  const person = () => root.FP?.ops?.user?.()?.id || null;
  // A place opened (main.js route): put first among the person's recent places. Staff only (no one else has this list).
  function visited(kind, id) {
    if (!root.FP?.ops?.isStaff?.() || !id) return;
    const k = recentKey(person());
    store.set(k, JSON.stringify(remember(store.get(k), kind === "farm" ? "farm" : "group", id)));
  }

  let token = 0, data = null, built = false, query = "";
  const $ = (s) => root.FP.$(s), el = (...a) => root.FP.el(...a);
  const icon = (name, size) => (root.FP.icon ? root.FP.icon(name, size) : "");
  // The screen is made here, once, the first time it is shown (never in index.html: the sign-in page's weight, SI1)
  function build() {
    if (built) return;
    built = true;
    const accountMenu = el("div", { id: "sh-account-menu", class: "account-menu" },
      el("span", { class: "who account-who" }), el("span", { class: "password-link" }, el("button", { type: "button", class: "link b-password" }, "Change password")),
      el("a", { class: "privacy-link", href: "#/privacy" }, "Privacy and terms"), el("button", { type: "button", class: "link b-signout" }, root.FP.demo?.active ? "Exit demo" : "Sign out"));
    const main = el("main", { id: "screen-staff-home", class: "sh-screen", "aria-labelledby": "sh-title", hidden: true },
      el("div", { class: "sh-page" }, el("div", { class: "sh-card" },
        el("header", { class: "sh-head" },
          el("h1", { id: "sh-title", class: "sh-title" }, "Places"),
          el("div", { class: "sh-account" },
            el("button", { type: "button", id: "sh-account-open", class: "account-open", "aria-haspopup": "true", "aria-expanded": "false", "aria-controls": "sh-account-menu", "aria-label": "Account" },
              el("span", { class: "account-initials", "aria-hidden": "true" })), accountMenu)),
        el("nav", { class: "sh-tools", "aria-label": "Tools" },
          el("a", { id: "sh-map", class: "sh-tool sh-tool-main", href: "#/places/map" }, icon("maps", 16), el("span", {}, "Map")),
          el("a", { id: "sh-ops", class: "sh-tool", href: "#/ops" }, icon("ops", 16), el("span", {}, "Operations"))),
        el("div", { id: "sh-find", class: "sh-find", role: "search", hidden: true },
          el("label", { for: "sh-search", class: "visually-hidden" }, "Find a farm or group"),
          icon("search", 16),
          el("input", { id: "sh-search", type: "search", autocomplete: "off", spellcheck: "false", placeholder: "Find a farm or group", "aria-controls": "sh-lists" })),
        el("div", { id: "sh-lists", class: "sh-lists" }),
        el("p", { id: "sh-none", class: "sh-none", role: "status" })),
        el("p", { class: "sh-who" }, el("span", { class: "who" }))));
    root.document.body.append(main);
    root.FP.accountMenu?.wire($("#sh-account-open"), accountMenu);
    const input = $("#sh-search");
    input.addEventListener("input", () => { query = input.value; draw(); });
    input.addEventListener("keydown", (e) => {
      const first = $("#sh-lists a.sh-row");
      if (e.key === "Enter" && first && query.trim()) { e.preventDefault(); first.click(); }
      else if (e.key === "ArrowDown" && first) { e.preventDefault(); first.focus(); }
      else if (e.key === "Escape" && input.value) { e.preventDefault(); input.value = ""; query = ""; draw(); }
    });
    root.addEventListener("resize", () => { if (!main.hidden) fitSearch(); });
  }
  const section = (id, title, items) => !items.length ? null : el("section", { class: "sh-section", "aria-labelledby": id },
    el("h2", { id, class: "sh-heading" }, title, el("span", { class: "sh-count", "aria-hidden": "true" }, String(items.length))),
    el("ul", { class: "sh-list", role: "list" }, ...items.map((x) => el("li", { "data-kind": x.kind },
      // (the demo's invented farms, "?places=many", have no space of their own: shown, but they open nothing)
      x.kind === "farm" && root.FP.demo?.active && root.FP.demo.isInvented?.(x.id)
        ? el("div", { class: "sh-row sh-inert", "aria-disabled": "true", "data-place": x.key }, el("span", { class: "sh-text" }, el("b", {}, x.name), el("small", {}, x.line + " · not opened in the demo")), el("span"))
        : el("a", { class: "sh-row", href: root.FP.href(x.href), "data-place": x.key },
          el("span", { class: "sh-text" }, el("b", {}, x.name), el("small", {}, x.line)), el("span", { class: "sh-chev", "aria-hidden": "true" }, icon("chevron", 14)))))));
  function draw() {
    if (!data) return;
    const shown = filter(data, query);
    $("#sh-lists").replaceChildren(...[section("sh-h-recent", "Recent", shown.recent), section("sh-h-groups", "Groups", shown.groups), section("sh-h-farms", "Farms", shown.farms)].filter(Boolean));
    const q = query.trim(), none = q && !shown.groups.length && !shown.farms.length;
    $("#sh-none").textContent = none ? "No farm or group matches “" + q + "”." : "";
  }
  function fitSearch() { const f = $("#sh-find"); if (f) f.hidden = !(searchShown(data?.count || 0, root.innerHeight) || query.trim()); }
  async function show({ farms = [], groups = [] } = {}) {
    const mine = ++token;
    build();
    const wasHidden = $("#screen-staff-home").hidden;
    root.FP.show("screen-staff-home");
    root.document.title = "Places | " + (root.FP.brand?.product || "");
    // the person's words for who is signed in, as the other screens show them (main.js fills .who and the initials at start-up)
    const who = [...root.document.querySelectorAll(".who")].find((n) => n.textContent)?.textContent || "";
    for (const n of root.document.querySelectorAll("#screen-staff-home .who")) n.textContent = who;
    $("#sh-account-open .account-initials").textContent = root.document.querySelector(".account-initials")?.textContent || "";
    $("#sh-ops").href = root.FP.href("#/ops");
    $("#sh-map").href = root.FP.href(MAP);
    if (wasHidden) { query = ""; $("#sh-search").value = ""; root.scrollTo?.(0, 0); }
    const recent = recentFrom(store.get(recentKey(person())));
    data = rows(farms, groups, { recent });
    draw(); fitSearch();
    // a sub-group whose parent group the person is not in: its parent's name, as Places reads it (no read when there is none)
    const parents = await (root.FP.home?.readParents?.(root.FP.sb, groups) || Promise.resolve({})).catch(() => ({}));
    if (mine !== token || $("#screen-staff-home").hidden || !Object.keys(parents).length) return;
    data = rows(farms, groups, { parents, recent });
    draw();
  }
  return { opensList, recentKey, recentFrom, remember, rows, filter, searchShown, visited, show, MAP, KEEP, SHOWN };
});
