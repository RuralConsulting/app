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
// rest. PL1 (19 Nov 2026): the rest by catchment group (the highest-level groups; one with sub-groups opens in place to "Whole group"
// and then its sub-groups) or by farm (under the top-level group each is in), the device's last choice, shared with the map's panel.
// Each row: the name, one quiet line (what it is, and the groups a farm is in or its region) and a chevron. Never a person's name or
// contact details, never a title's owners: those are not in what the list is given.
// Reads: none of its own; Places' own two, through home.js: the parents' names (readParents: only for a sub-group whose parent group
// the person is not in, and none otherwise) and PL1's farms' groups (readLinks: once a visit, shared with the map). The map's
// outlines are read only when the map is opened.
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
  // The rows. Each row { key, kind ("farm" | "group" | "subgroup"), id, name, line, href }. farms and groups as main.js read them
  // (farms: id, name, region, org_id; groups: id, name, slug, parent_org_id, role); parents: id -> name, for parents the person is not
  // in (home.js readParents); links: the farms' active associations with the person's groups (home.js readLinks: farm_id, org_id).
  //   recent      the person's recent places (these stay in the lists below too: PL1's lists are whole, each place where it belongs)
  //   groups      every group and sub-group, in Places' order (groups A to Z, each followed by its sub-groups): what search looks in
  //   farms       every farm, A to Z, its line what it is and the groups it is in (else its region)
  //   catchments  PL1: the highest-level groups, each { row, children: [row] } (its sub-groups, opened in place under "Whole group")
  //   farmGroups  PL1: the farms under the highest-level group each is in, { key, name, group: row | null, farms: [row] }, the farm's
  //               line there naming the sub-groups it is in, if any; a last heading for farms in none
  //   views       which of the two lists the person has ("groups", "farms"); the choice shows only with both
  //   favourites  PL2: the person's favourite places they can see now (favs: home.js favouritesNow, newest first), each with its search line
  //   stars       PL2: whether rows carry a star (not with one place only)
  function rows(farms, groups, { parents = {}, recent = [], links = [], favs = [] } = {}) {
    const list = (v) => (Array.isArray(v) ? v : []);
    const places = H().places(list(farms), list(groups), parents), joined = H().linksFrom(list(farms), list(links));
    const farmOf = new Map(list(farms).map((f) => [f.id, f]));
    const subs = new Map(H().catchments(places).map(({ place, children }) => [place.id, children.length]));
    const farmLine = (p, names) => { const where = names.length ? names.join(", ") : titleCase(farmOf.get(p.id)?.region); return "Farm" + (where ? " · " + where : ""); };
    const line = (p) => {
      if (p.kind === "farm") return farmLine(p, H().groupsOf(places, joined, p.id).map((g) => g.name));
      if (p.kind === "subgroup") return H().kindLabel(p);
      return "Catchment group" + (subs.get(p.id) ? " · " + plural(subs.get(p.id), "sub-group", "sub-groups") : "");
    };
    const row = (p, i) => ({ key: (p.kind === "farm" ? "farm:" : "group:") + p.id, kind: p.kind, id: p.id, name: p.name, line: line(p), href: H().openHref(p), at: i });
    const all = places.map(row), byKey = new Map(all.map((r) => [r.key, r]));
    // a top-level sub-group (its parent not the person's) keeps "Sub-group of …"; under its top group a sub-group is just "Sub-group"
    // (or "Sub-group of …" one level further down)
    const under = (top, c) => ({ ...byKey.get("group:" + c.id), line: c.within && c.within !== top.id ? H().kindLabel(c) : "Sub-group" });
    return {
      recent: recentFrom(recent).map((k) => byKey.get(k)).filter(Boolean).slice(0, SHOWN),
      groups: all.filter((r) => r.kind !== "farm"),
      farms: all.filter((r) => r.kind === "farm").sort(byName),
      catchments: H().catchments(places).map(({ place, children }) => ({ row: byKey.get("group:" + place.id), children: children.map((c) => under(place, c)) })),
      farmGroups: H().farmGroups(places, joined).map(({ group, farms: fs, bare }) => ({ key: group ? "group:" + group.id : "none", name: group ? group.name : H().NO_GROUP, bare: !!bare, group: group ? byKey.get("group:" + group.id) : null,
        farms: fs.map(({ place, via }) => ({ ...byKey.get("farm:" + place.id), line: farmLine(place, via.map((v) => v.name)) })) })),
      views: H().views(places),
      favourites: H().favouritePlaces(places, favs).map((p) => byKey.get(H().favKey(p))).filter(Boolean),
      stars: H().starsShown(places),
      places,
      count: all.length,
    };
  }
  // The search: every place whose name or quiet line holds every word typed, any case, with or without macrons; in
  // the list's own order (groups, then farms). The quiet line counts, so a group's name finds its farms.
  function filter(r, query) {
    const words = H().fold(query).split(/\s+/).filter(Boolean);
    if (!words.length) return r;
    const hit = (x) => { const hay = H().fold(x.name + " " + x.line); return words.every((w) => hay.includes(w)); };
    const both = [...r.groups, ...r.farms];
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
        el("p", { id: "sh-none", class: "sh-none", role: "status" }),
        el("p", { class: "fav-note sh-fav-note", role: "status" })),
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
    // PL2: a star: the place in or out of the person's favourites (never opens the place)
    root.FP.home?.onFavourites?.(favsChanged);
    $("#sh-lists").addEventListener("click", (e) => {
      const st = e.target.closest(".fav-star");
      if (!st) return;
      e.preventDefault();
      const p = data?.places.find((x) => H().favKey(x) === st.dataset.favKey);
      if (p) root.FP.home?.toggleFavourite?.(p);
    });
    // PL1: a top group opens in place (Whole group, then its sub-groups); a heading of farms folds and unfolds
    $("#sh-lists").addEventListener("click", (e) => {
      const b = e.target.closest("[data-fold]");
      if (!b) return;
      const open = b.getAttribute("aria-expanded") !== "true", key = b.dataset.fold, inside = root.document.getElementById(b.getAttribute("aria-controls"));
      b.setAttribute("aria-expanded", String(open));
      if (inside) inside.hidden = !open;
      // (a group is remembered open, a heading of farms remembered closed)
      if (key.startsWith("g:") === open) folds.add(key); else folds.delete(key);
    });
  }
  // One row: a link to the place (the demo's invented farms, "?places=many", have no space of their own: shown, but they open nothing)
  const starOf = (x) => (data?.stars && root.FP.home?.star ? root.FP.home.star(x, "sh-star") : null);
  const rowOf = (x, { name = null } = {}) => el("li", { "data-kind": x.kind, ...(data?.stars ? { class: "sh-starred" } : {}) },
    x.kind === "farm" && root.FP.demo?.active && root.FP.demo.isInvented?.(x.id)
      ? el("div", { class: "sh-row sh-inert", "aria-disabled": "true", "data-place": x.key }, el("span", { class: "sh-text" }, el("b", {}, x.name), el("small", {}, x.line + " · not opened in the demo")), el("span"))
      : el("a", { class: "sh-row", href: root.FP.href(x.href), "data-place": x.key, ...(name ? { "aria-label": name + ", " + x.name } : {}) },
        el("span", { class: "sh-text" }, el("b", {}, name || x.name), el("small", {}, name ? "All of " + x.name : x.line)), el("span", { class: "sh-chev", "aria-hidden": "true" }, icon("chevron", 14))),
    starOf(x));
  const list = (items) => el("ul", { class: "sh-list", role: "list" }, ...items);
  const section = (id, title, items) => !items.length ? null : el("section", { class: "sh-section", "aria-labelledby": id },
    el("h2", { id, class: "sh-heading" }, title, el("span", { class: "sh-count", "aria-hidden": "true" }, String(items.length))), list(items.map((x) => rowOf(x))));
  // PL1: a row that opens in place (a top group with sub-groups; a heading of farms), its rows under it
  // folds: the groups opened ("g:<key>") and the farm headings closed ("f:<key>"), for this visit
  const folds = new Set();
  const foldId = (key) => "sh-in-" + key.replace(/[^\w-]/g, "-");
  function opener(fold, open, label, head, inside, cls, place = null) {
    const st = place && starOf(place);
    return el("li", { class: cls + (st ? " sh-starred" : "") },
      el("button", { type: "button", class: cls === "sh-top" ? "sh-row sh-open" : "sh-group-head", "aria-expanded": String(open), "aria-controls": foldId(fold), "data-fold": fold, "aria-label": label },
        ...head, el("span", { class: "sh-caret", "aria-hidden": "true" }, icon("chevron", 14))),
      st,
      el("ul", { class: "sh-list sh-sub", id: foldId(fold), role: "list", ...(open ? {} : { hidden: true }) }, ...inside));
  }
  // Catchment groups: the highest-level groups only; one with sub-groups opens in place to "Whole group", then its sub-groups
  function byGroups(d) {
    return d.catchments.map(({ row: r, children }) => {
      if (!children.length) return rowOf(r);
      const fold = "g:" + r.key, open = folds.has(fold);
      return opener(fold, open, r.name + ", " + r.line, [el("span", { class: "sh-text" }, el("b", {}, r.name), el("small", {}, r.line))],
        [rowOf(r, { name: "Whole group" }), ...children.map((c) => rowOf(c))], "sh-top", r);
    });
  }
  // Farms: under the highest-level group each is in, each heading folding; names A to Z
  function byFarms(d) {
    // (one bucket of farms in no group the person sees, and nothing else: no heading, just the farms)
    if (d.farmGroups.length === 1 && d.farmGroups[0].bare) return d.farmGroups[0].farms.map((x) => rowOf(x));
    return d.farmGroups.map((h) => {
      const fold = "f:" + h.key, n = h.farms.length;
      return opener(fold, !folds.has(fold), h.name + ", " + plural(n, "farm", "farms"),
        [el("span", { class: "sh-group-name" }, h.name), el("span", { class: "sh-count", "aria-hidden": "true" }, String(n))], h.farms.map((x) => rowOf(x)), "sh-farm-group");
    });
  }
  // the device's choice, shared with the map's panel (home.js), so the two views agree
  const viewNow = (d) => root.FP.home?.viewNow?.(d.places) || (d.views.includes(localView) ? localView : d.views[0] || "groups");
  let localView = null;
  function draw() {
    if (!data) return;
    const q = query.trim();
    if (q) {
      const shown = filter(data, query);
      $("#sh-lists").replaceChildren(...[section("sh-h-groups", "Groups", shown.groups), section("sh-h-farms", "Farms", shown.farms)].filter(Boolean));
      $("#sh-none").textContent = !shown.groups.length && !shown.farms.length ? "No farm or group matches “" + q + "”." : "";
      return;
    }
    $("#sh-none").textContent = "";
    const view = viewNow(data), both = data.views.length > 1;
    const seg = both ? (root.FP.home?.viewSwitch?.("sh-view", view, (v) => { root.FP.home?.chooseView?.(v); localView = v; draw(); $('#sh-view [data-view="' + v + '"]')?.focus(); }) || null) : null;
    const main = view === "farms"
      ? el("section", { class: "sh-section", "aria-label": "Farms, by catchment group" }, both ? null : el("h2", { class: "sh-heading" }, "Farms"), el("ul", { class: "sh-list" + (data.farmGroups.length === 1 && data.farmGroups[0].bare ? "" : " sh-folds"), role: "list" }, ...byFarms(data)))
      : el("section", { class: "sh-section", "aria-label": "Catchment groups" }, both ? null : el("h2", { class: "sh-heading" }, "Catchment groups"), list(byGroups(data)));
    $("#sh-lists").replaceChildren(...[favSection(), section("sh-h-recent", "Recent", data.recent), seg && el("div", { class: "sh-views" }, seg), main].filter(Boolean));
  }
  // PL2: Favourites, above Recent, only when there is at least one (newest first; what each is and where it belongs, as search says)
  const favSection = () => section("sh-h-favs", "Favourites", data?.favourites || []);
  // a star tapped (here or on the map's panel): every star of that place agrees, and the Favourites section follows; the focus stays
  // on the star tapped, or, when that row left Favourites, moves to the same place's star in the list below
  function favsChanged(key) {
    if (!data || $("#screen-staff-home")?.hidden) return;
    data = { ...data, favourites: H().favouritePlaces(data.places, root.FP.home?.favouritesNow?.() || []).map((p) => data.groups.concat(data.farms).find((r) => r.key === H().favKey(p))).filter(Boolean) };
    root.FP.home?.paintStars?.($("#screen-staff-home"), data.places);
    if (query.trim()) return;
    const had = root.document.activeElement, old = $('#sh-lists [aria-labelledby="sh-h-favs"]'), fresh = favSection();
    if (old && fresh) old.replaceWith(fresh); else if (old) old.remove(); else if (fresh) $("#sh-lists").prepend(fresh);
    if (had && !had.isConnected && key) $('#sh-lists .fav-star[data-fav-key="' + key + '"]')?.focus();
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
    const favsNow = () => root.FP.home?.favouritesNow?.() || [];
    let more = {};
    const made = (m) => { more = m; return rows(farms, groups, { recent, favs: favsNow(), ...m }); };
    data = made({});
    draw(); fitSearch();
    // PL2: the person's favourites (home.js: once a visit, shared with the map; offline the last read), drawn once known
    (root.FP.home?.readFavourites?.(root.FP.sb) || Promise.resolve()).then(() => {
      if (mine !== token || $("#screen-staff-home").hidden) return;
      data = rows(farms, groups, { recent, favs: favsNow(), ...more }); draw();
    }, () => {});
    // a sub-group whose parent group the person is not in: its parent's name, as Places reads it (no read when there is none); PL1: the
    // groups each farm is in beyond its own (home.js readLinks: once a visit, shared with the map; none without a farm and a group)
    const [parents, links] = await Promise.all([
      (root.FP.home?.readParents?.(root.FP.sb, groups) || Promise.resolve({})).catch(() => ({})),
      (root.FP.home?.readLinks?.(root.FP.sb, farms, groups) || Promise.resolve([])).catch(() => [])]);
    if (mine !== token || $("#screen-staff-home").hidden || (!Object.keys(parents).length && !links.length)) return;
    data = made({ parents, links });
    draw();
  }
  return { opensList, recentKey, recentFrom, remember, rows, filter, searchShown, visited, show, MAP, KEEP, SHOWN };
});
