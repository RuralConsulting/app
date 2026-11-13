// J2: Home, the first section of every place (docs/PRODUCT.md): search, the add actions shown openly, shortcuts to the
// place's sections with one quiet line each, and anything waiting as one quiet line. A launcher, not a dashboard: no to-do
// list, no feed, no chart, no map. The pure parts: which blocks a person gets (only what they may already open or add), the
// words, and the search over lists the sections already read. No DOM, no reads: place-home.js reads as the signed-in person
// and hands the rows here.
(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const api = factory(root, node ? { people: require("./people-model.js"), farm: require("./farm-model.js"), group: require("./group-model.js") } : null);
  if (node) module.exports = api; else { root.FP = root.FP || {}; root.FP.placeHomeModel = api; }
})(typeof window === "undefined" ? globalThis : window, function (root, nodeModels) {
  const models = () => nodeModels || { people: root.FP.peopleModel, farm: root.FP.farmModel, group: root.FP.groupModel };
  const plural = (n, one, many) => n + " " + (n === 1 ? one : many);
  // Words folded for matching: lower case, accents off (a macron typed or not finds the same name), runs of space as one
  const fold = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  const words = (q) => fold(q).split(" ").filter(Boolean);
  const hits = (hay, ws) => { const h = fold(hay); return ws.every((w) => h.includes(w)); };

  // ---- what is searched ------------------------------------------------------------------------------------------------------
  // The kinds of thing Home's search finds, in the order the results are grouped. Each only where the person can open the
  // section it belongs to (its tab): Files, Maps and Events by the space's sections; members and people only for the roles the
  // People tab is for (people-model canSeeTab: a group's facilitators, advisors and admins); places (a group's sub-groups) only
  // those the person can open themselves.
  const KINDS = {
    people: { label: "Members and people", icon: "people" },
    files: { label: "Files", icon: "files" },
    events: { label: "Events", icon: "events" },
    maps: { label: "Maps", icon: "maps" },
    places: { label: "Places", icon: "places" },
  };
  const ORDER = ["people", "files", "events", "maps", "places"];
  const keys = (sections) => (Array.isArray(sections) ? sections : []).map((s) => (Array.isArray(s) ? s[0] : s?.key)).filter(Boolean);
  function searchKinds({ space, sections, people = false, places = false } = {}) {
    const k = keys(sections), group = space === "group";
    return ORDER.filter((kind) => (kind === "people" ? group && people && k.includes("people")
      : kind === "files" ? k.includes("documents")
      : kind === "events" ? group && k.includes("events")
      : kind === "maps" ? k.includes("maps")
      : group && !!places));
  }
  // The search field: a short hint that fits a phone ("Search this group"), and its name for a screen reader saying what it finds
  // ("Search HDLG: members and people, files, events and maps")
  const placeholder = (space) => "Search this " + (space === "farm" ? "farm" : "group");
  function searchLabel(kinds, name) {
    const n = (kinds || []).map((k) => KINDS[k]?.label.toLowerCase()).filter(Boolean);
    return "Search " + String(name || "") + (n.length ? ": " + (n.length === 1 ? n[0] : n.slice(0, -1).join(", ") + " and " + n[n.length - 1]) : "");
  }

  // ---- the search --------------------------------------------------------------------------------------------------------------
  const TZ = "Pacific/Auckland";
  // Days are New Zealand's, summer (NZDT, +13:00) and winter (NZST, +12:00) alike: the day an instant falls on there, and the instant
  // a day starts there (group-model.js's isoDay and nzMidnight, shared, not a fixed offset)
  const nzDay = (t = Date.now()) => (Number.isFinite(new Date(t).getTime()) ? models().group.isoDay(t) : null);
  function nzDayStart(day) {
    const [y, m, d] = String(day).slice(0, 10).split("-").map(Number);
    return models().group.nzMidnight(y, m, d).toISOString();
  }
  const shortDay = (t) => { const d = Date.parse(t); return Number.isFinite(d) ? new Date(d).toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric", timeZone: TZ }) : ""; };
  // lists: { files: [documents rows, a member farm's shared ones with shared: true], maps: [{ id, title }], events: [group_events rows],
  // people: { directory, people } (People's own lists), places: [{ id, kind: "farm"|"group", name, note }] }. Returns the kinds that
  // matched, in order, each with at most `max` items and how many matched: [{ kind, label, icon, total, items: [{ id, title, note, open }] }].
  // open says where the item goes: { view, item } (a section opened at the thing), { view, q } (a section with its own search filled),
  // { view: "events", event } (Events at the event) or { place: { kind, id } } (another place's Home).
  function search(lists, q, kinds, { space = "group", max = 5, today = null } = {}) {
    const ws = words(q), L = lists || {};
    if (!ws.length) return [];
    const out = [];
    for (const kind of kinds || []) {
      let found = [];
      if (kind === "files") {
        found = (L.files || []).filter((d) => hits([d.title, d.original_name, models().farm?.docKind?.(d.doc_type)].join(" | "), ws)).map((d) => ({ id: d.id, title: d.title || d.original_name || "Untitled",
          note: [models().farm?.docKind?.(d.doc_type), d.date_prepared ? shortDay(d.date_prepared + "T12:00:00Z") : null, d.shared ? "shared by a member farm" : null, d.status === "superseded" ? "superseded" : null].filter(Boolean).join(" · "),
          // a farm's Files opens at the file (its ?item); a group's Files has its own search, filled with the title
          open: space === "farm" ? { view: "documents", item: d.id } : { view: "documents", q: d.title || d.original_name || "" } }));
      } else if (kind === "maps") {
        found = (L.maps || []).filter((m) => hits([m.title, m.description].join(" | "), ws)).map((m) => ({ id: m.id, title: m.title || "Map", note: "Published map", open: { view: "maps", item: m.id } }));
      } else if (kind === "events") {
        const day = today ? String(today).slice(0, 10) : nzDay();
        const evs = (L.events || []).filter((e) => !e.cancelled_at && hits([e.title, e.place_name, ...(e.topics || [])].join(" | "), ws));
        // upcoming first (soonest first), then past (most recent first)
        const upcoming = (e) => (nzDay(e.starts_at) || "") >= day;
        evs.sort((a, b) => (upcoming(b) - upcoming(a)) || (upcoming(a) ? String(a.starts_at).localeCompare(String(b.starts_at)) : String(b.starts_at).localeCompare(String(a.starts_at))));
        found = evs.map((e) => ({ id: e.id, title: e.title || "Event", note: [shortDay(e.starts_at), e.place_name].filter(Boolean).join(" · "), open: { view: "events", event: e.id } }));
      } else if (kind === "people") {
        const P = models().people, d = L.people?.directory || [], p = L.people?.people || [];
        found = P ? P.whoWith(d, p, q, [], 50).map((r) => ({ id: r.kind + ":" + r.id, title: r.name, note: r.kind === "business" ? r.note : "Person · " + r.note, open: { view: "people", q: r.name } })) : [];
      } else if (kind === "places") {
        found = (L.places || []).filter((x) => hits(x.name, ws)).map((x) => ({ id: x.kind + ":" + x.id, title: x.name, note: x.note || (x.kind === "farm" ? "Farm" : "Sub-group"), open: { place: { kind: x.kind, id: x.id } } }));
      }
      if (found.length) out.push({ kind, label: KINDS[kind].label, icon: KINDS[kind].icon, total: found.length, items: found.slice(0, max) });
    }
    return out;
  }
  const nothingFound = (q) => "Nothing found for “" + String(q || "").trim() + "”";

  // ---- the add actions ----------------------------------------------------------------------------------------------------------
  // What the + offers here (add.js registry.available(ctx)), shown openly in the same order, with the registry's own words for them.
  // Nothing is added here that the registry did not give: with none, the block is absent.
  const adds = (available) => (Array.isArray(available) ? available : []).map((a) => ({ id: a.id, text: a.verb || "Add " + String(a.label || "").toLowerCase(), icon: a.icon, action: a }));

  // ---- the shortcuts ------------------------------------------------------------------------------------------------------------
  // The place's sections the person can open, other than Home, each with one quiet line where it is cheap to know.
  // facts: { maps: n | null, files: n | null, nextEvent: { starts_at, title } | null | undefined (not read) }
  const STATIC = {
    maps: "Published maps", documents: "Plans, consents and reports", events: "The group's calendar", people: "Members and the people linked to them", records: "Photos, water samples and pest control",
    map: "The map with its layers and cards (RCL staff)", ask: "Ask about this farm (RCL staff)", create: "Reports and updates (RCL staff)", manage: "Members, checks and settings",
  };
  function eventLine(ev) {
    if (!ev) return null;
    const d = Date.parse(ev.starts_at);
    const when = Number.isFinite(d) ? new Date(d).toLocaleDateString("en-NZ", { weekday: "short", day: "numeric", month: "short", timeZone: TZ }).replace(",", "") : "";
    return "Next: " + [when, ev.title].filter(Boolean).join(" · ");
  }
  function shortcutLine(key, facts = {}) {
    if (key === "maps" && Number.isInteger(facts.maps)) return facts.maps ? plural(facts.maps, "map", "maps") : "Nothing published yet";
    if (key === "documents" && Number.isInteger(facts.files)) return facts.files ? plural(facts.files, "file", "files") : "No files yet";
    if (key === "events" && facts.nextEvent !== undefined) return facts.nextEvent ? eventLine(facts.nextEvent) : "Nothing coming up";
    return STATIC[key] || null;
  }
  function shortcuts(sections, facts = {}) {
    return (Array.isArray(sections) ? sections : []).map((s) => (Array.isArray(s) ? { key: s[0], label: s[1] } : s))
      .filter((s) => s?.key && s.key !== "home").map((s) => ({ key: s.key, label: s.label, line: shortcutLine(s.key, facts) }));
  }

  // ---- anything waiting ---------------------------------------------------------------------------------------------------------
  // One quiet line, only for people who can act on what it counts (People's roles: follow-ups due and items to review), and only
  // when there is something. counts: { followUps, review } (null or absent: not read, or not for this person).
  function waiting(counts = {}) {
    const items = [];
    if (Number(counts.followUps) > 0) items.push({ key: "follow-ups", text: plural(Number(counts.followUps), "follow-up", "follow-ups") + " due", view: "people", tab: "follow-ups" });
    if (Number(counts.review) > 0) items.push({ key: "review", text: Number(counts.review) + " to review", view: "people", tab: "review" });
    return items.length ? { items } : null;
  }

  // ---- the whole Home, for one person in one place --------------------------------------------------------------------------------
  // input: { space, sections (the person's tabs, [[key, label]]), people (may see People), places (any place to find), available (the
  // registry's actions here), facts, counts }. Returns the blocks Home draws, in order; a block the person has nothing in is absent.
  function build({ space = "group", sections = [], people = false, places = false, available = [], facts = {}, counts = {} } = {}) {
    const kinds = searchKinds({ space, sections, people, places });
    const blocks = [];
    if (kinds.length) blocks.push({ block: "search", kinds, placeholder: placeholder(space) });
    const a = adds(available);
    if (a.length) blocks.push({ block: "adds", items: a });
    const s = shortcuts(sections, facts);
    if (s.length) blocks.push({ block: "sections", items: s });
    const w = people ? waiting(counts) : null;
    if (w) blocks.push({ block: "waiting", ...w });
    return blocks;
  }
  // Debounce: one call after the typing stops for `ms` (the search never reads per keystroke; this only paces the redraw).
  function debounce(fn, ms = 180, timers = { set: (f, t) => setTimeout(f, t), clear: (t) => clearTimeout(t) }) {
    let t = null;
    const d = (...args) => { timers.clear(t); t = timers.set(() => { t = null; fn(...args); }, ms); };
    d.cancel = () => { timers.clear(t); t = null; };
    return d;
  }

  return { KINDS, ORDER, TZ, nzDay, nzDayStart, fold, words, searchKinds, placeholder, searchLabel, search, nothingFound, adds, STATIC, shortcutLine, shortcuts, eventLine, waiting, build, debounce, plural };
});
