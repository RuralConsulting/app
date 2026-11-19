// AD1: search for an address and take the map there (the owner, 19 Nov 2026: "with add block, I'd like to be able to search an
// address. Actually I'd like searching an address to be possible for other functions where it might be helpful as well.").
// One shared piece: FP.addressSearch.attach(map, options) puts a search box on a map. Typing at least 3 letters or digits asks the
// database's address_search (LINZ's address points, loaded by tools/load_addresses.py; readable by anyone signed in) after a short
// pause, biased to the map's centre; up to 8 addresses come back as a list (a combobox: arrows, Enter, Escape). Choosing one flies
// the map there and drops a temporary marker, which goes when the box is cleared or the box is let go (destroy). Calm states only:
// "No address found.", "Search needs a connection.". Nothing outlives its map (MEM1): destroy() cancels the pause and the request in
// flight, takes the marker off, removes every listener it added and its box; the map's own "remove" also calls it.
// The pure parts (normalise, the query words, rank, the search's state) have no page or map, so tests and the demo use them too.
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api; else (root.FP = root.FP || {}).addressSearch = api;
})(typeof window === "undefined" ? globalThis : window, function (root) {
  const MIN = 3, MAX = 8, WAIT = 250, ZOOM = 15, WORDS = 8, LONGEST = 120;
  const SAY = { none: "No address found.", offline: "Search needs a connection.", error: "The search didn't work. Try again." };

  // ---- the words: as the database's public.address_fold, address_canon_word and address_search_text (migration 20261113087000),
  // so the demo finds and ranks as the database does (tests/app/ad1-address-search.test.cjs keeps the lists equal) -----------------
  const FROM = "āēīōūàáâäãèéêëìíîïòóôöõùúûüçñ", TO = "aeiouaaaaaeeeeiiiiooooouuuucn";
  function normalise(text) {
    let s = String(text ?? "").toLowerCase().replace(/['’]/g, "");
    s = [...s].map((c) => { const i = FROM.indexOf(c); return i < 0 ? c : TO[i]; }).join("");
    return s.replace(/[^a-z0-9]+/g, " ").trim();
  }
  // a street type's short form as its whole word (Rd is Road, both ways), and the street types a typo search does not require
  const SHORT = { rd: "road", st: "street", str: "street", ave: "avenue", av: "avenue", tce: "terrace", terr: "terrace", dr: "drive",
    pl: "place", cres: "crescent", cr: "crescent", ln: "lane", hwy: "highway", ct: "court", crt: "court", cl: "close", gr: "grove",
    gv: "grove", pde: "parade", sq: "square", blvd: "boulevard", esp: "esplanade", mt: "mount", wy: "way" };
  const STREET_TYPES = ["road", "street", "avenue", "terrace", "drive", "place", "crescent", "lane", "highway", "court", "close", "grove",
    "parade", "square", "boulevard", "esplanade", "way", "rise", "track", "quay", "mews", "heights", "loop", "glade", "view", "walk",
    "row", "green", "line"];
  const canon = (w) => SHORT[w] || w;
  const searchText = (text) => normalise(text).split(" ").filter(Boolean).map(canon).join(" ");
  // what a search asks for: the first 8 words of the first 120 characters, or null when fewer than 3 letters or digits
  function words(text) {
    const t = normalise(String(text ?? "").slice(0, LONGEST));
    if (t.replace(/ /g, "").length < MIN) return null;
    return t.split(" ").slice(0, WORDS);
  }
  function metres(a, b) {
    const r = Math.PI / 180, dLat = (b[1] - a[1]) * r, dLon = (b[0] - a[0]) * r;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLon / 2) ** 2;
    return 2 * 6371008.8 * Math.asin(Math.sqrt(h));
  }
  // one edit (a letter wrong, missing, extra, or two swapped), as the database's deletions table finds; two for a long word
  function near1(a, b) {
    if (a === b) return true;
    if (Math.abs(a.length - b.length) > 1) return false;
    const del = (w) => new Set([...w].map((_, i) => w.slice(0, i) + w.slice(i + 1)));
    const da = del(a), db = del(b);
    return da.has(b) || db.has(a) || [...da].some((x) => db.has(x));
  }
  function alike(typed, own) {
    if (own === typed || near1(typed, own)) return true;
    if (typed.length < 6) return false;
    const grams = (w) => { const p = "  " + w + " ", g = new Set(); for (let i = 0; i < p.length - 2; i++) g.add(p.slice(i, i + 3)); return g; };
    const a = grams(typed), b = grams(own), both = [...a].filter((x) => b.has(x)).length;
    return both / (a.size + b.size - both) >= 0.4;      // pg_trgm's similarity
  }
  // As the database finds and ranks (public.address_search): 1. as typed, every word, the last as a prefix: starts with what was
  // typed first, then the phrase from a word's start, then the rest; then nearest, shorter, A to Z. Then, while fewer than max:
  // 2. with typos (street types not required, numbers as typed, a short last word as a prefix), 3. the same with the numbers not
  // required.
  function rank(rows, text, near = null, max = MAX) {
    const raw = words(text);
    if (!raw) return [];
    const k = raw.length, w = raw.map(canon), last = raw[k - 1];
    const t = [...w.slice(0, -1), last].join(" "), tc = w.join(" ");
    const n = Math.min(Math.max(Number.isFinite(max) ? Math.trunc(max) : MAX, 1), MAX);
    const all = (rows || []).map((r) => ({ r, s: searchText(r.address) })).map((x) => ({ ...x, own: x.s.split(" "), d: near ? metres(near, [x.r.longitude, x.r.latitude]) : 0 }));
    const starts = (s) => s.startsWith(t) || s.startsWith(tc), phrase = (s) => (" " + s + " ").includes(" " + t) || (" " + s + " ").includes(" " + tc);
    const by = (a, b) => a.q - b.q || a.d - b.d || a.r.address.length - b.r.address.length || (a.r.address < b.r.address ? -1 : a.r.address > b.r.address ? 1 : 0);
    const out = all.filter((x) => w.slice(0, -1).every((y) => x.own.includes(y)) && x.own.some((y) => y.startsWith(last) || y.startsWith(w[k - 1])))
      .map((x) => ({ ...x, q: starts(x.s) ? 0 : phrase(x.s) ? 1 : 2 })).sort(by).slice(0, n);
    for (const step of [2, 3]) {
      if (out.length >= n) break;
      const need = w.map((y, i) => ({ y, i })).filter(({ y, i }) => (/[0-9]/.test(y) ? step === 2 : !STREET_TYPES.includes(y) && (y.length >= 3 || i === k - 1)));
      if (!need.length) continue;
      const more = all.filter((x) => !out.some((o) => o.r === x.r) && need.every(({ y, i }) => x.own.some((o) => (/[0-9]/.test(y) || y.length < 3 ? o === y || (i === k - 1 && o.startsWith(y)) : alike(y, o) || (i === k - 1 && o.startsWith(y))))))
        .map((x) => ({ ...x, q: -need.filter(({ y }) => x.own.includes(y)).length })).sort(by);
      out.push(...more.slice(0, n - out.length));
    }
    return out.map(({ r }) => ({ address: r.address, locality: r.locality ?? null, longitude: r.longitude, latitude: r.latitude }));
  }
  // near as the database takes it: a WGS84 point in EWKT, from a map's centre ([lng, lat] or {lng, lat})
  function nearText(c) {
    const lng = Array.isArray(c) ? c[0] : c?.lng, lat = Array.isArray(c) ? c[1] : c?.lat;
    return Number.isFinite(lng) && Number.isFinite(lat) ? "SRID=4326;POINT(" + lng.toFixed(6) + " " + lat.toFixed(6) + ")" : null;
  }
  function parseNear(text) {
    const m = /POINT\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)/i.exec(String(text || ""));
    return m ? [Number(m[1]), Number(m[2])] : null;
  }
  const offline = (e) => /fetch|network|offline|load failed/i.test(String(e?.message || e || ""));

  // ---- the search's state: the pause, the request in flight, the list and the keys --------------------------------------------
  // run(q, near, signal) -> Promise<rows>; near() -> [lng, lat] | null; onChange(state). timers and online can be given (tests).
  function createSearch({ run, near = () => null, onChange = () => {}, wait = WAIT, timers = root, online = () => root.navigator?.onLine !== false }) {
    const state = { text: "", results: [], active: -1, status: "idle", chosen: null };
    let timer = null, ctrl = null, asked = 0, dead = false;
    const changed = () => { if (!dead) onChange(state); };
    function stop() {
      if (timer != null) { timers.clearTimeout(timer); timer = null; }
      if (ctrl) { try { ctrl.abort(); } catch { /* already done */ } ctrl = null; }
      asked++;                                   // a reply still on its way is dropped
    }
    async function go(text) {
      timer = null;
      const mine = ++asked;
      if (!online()) { Object.assign(state, { results: [], active: -1, status: "offline" }); changed(); return; }
      ctrl = typeof AbortController === "function" ? new AbortController() : null;
      state.status = "searching"; changed();
      try {
        const rows = await run(text, near(), ctrl?.signal);
        if (mine !== asked || dead) return;
        const list = (Array.isArray(rows) ? rows : []).slice(0, MAX);
        Object.assign(state, { results: list, active: -1, status: list.length ? "results" : "none" });
      } catch (e) {
        if (mine !== asked || dead) return;
        Object.assign(state, { results: [], active: -1, status: offline(e) || !online() ? "offline" : "error" });
      }
      ctrl = null;
      changed();
    }
    return {
      state,
      input(text) {
        if (dead) return;
        stop();
        state.text = String(text ?? "");
        state.chosen = null;
        if (!words(state.text)) { Object.assign(state, { results: [], active: -1, status: "idle" }); changed(); return; }
        timer = timers.setTimeout(() => go(state.text), wait);
        changed();
      },
      // a key in the box: what it did ("move", "choose", "close", "clear") or null when the box leaves it to the page
      key(name) {
        if (dead) return null;
        const n = state.results.length;
        if (name === "ArrowDown" || name === "ArrowUp") {
          if (!n) return null;
          state.active = name === "ArrowDown" ? (state.active + 1) % n : state.active <= 0 ? n - 1 : state.active - 1;
          changed(); return "move";
        }
        if (name === "Enter") return n ? "choose" : null;
        if (name === "Escape") {
          if (n || ["none", "offline", "error", "searching"].includes(state.status)) { stop(); Object.assign(state, { results: [], active: -1, status: "idle" }); changed(); return "close"; }
          if (state.text) return "clear";
          return null;
        }
        return null;
      },
      choose(i = state.active < 0 ? 0 : state.active) {
        const row = state.results[i];
        if (!row || dead) return null;
        stop();
        Object.assign(state, { text: row.address, chosen: row, results: [], active: -1, status: "idle" });
        changed();
        return row;
      },
      close() { if (dead) return; stop(); Object.assign(state, { results: [], active: -1, status: "idle" }); changed(); },
      clear() { if (dead) return; stop(); Object.assign(state, { text: "", chosen: null, results: [], active: -1, status: "idle" }); changed(); },
      destroy() { if (dead) return; stop(); dead = true; },
      get pending() { return timer != null || ctrl != null; },
    };
  }

  // The database's search, through the app's client: abortable when the client offers it (supabase-js), plain otherwise (the demo)
  function rpcRunner(sb) {
    return (q, near, signal) => {
      let req = sb.rpc("address_search", { q, near: nearText(near), max: MAX });
      if (signal && req && typeof req.abortSignal === "function") req = req.abortSignal(signal);
      return Promise.resolve(req).then((r) => { if (r?.error) throw r.error; return r?.data || []; });
    };
  }

  // ---- on a map -----------------------------------------------------------------------------------------------------------------
  // options: host (where the box goes), sb (the client; default FP.sb), run (instead of sb), label, placeholder, zoom,
  // padding() -> MapLibre padding for the fly (to keep the place clear of a panel), onChoose(row), document, maplibregl.
  let made = 0;
  function attach(map, options = {}) {
    const doc = options.document || root.document, ML = options.maplibregl || root.maplibregl;
    const id = "addr-" + ++made;
    const el = (tag, attrs = {}) => { const n = doc.createElement(tag); for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v); return n; };
    const box = el("div", { class: "addr-search", role: "search" });
    const label = el("label", { for: id + "-q", class: "visually-hidden" });
    label.textContent = options.label || "Find an address";
    const field = el("div", { class: "addr-field" });
    const input = el("input", { id: id + "-q", type: "search", class: "addr-input", role: "combobox", "aria-autocomplete": "list", "aria-expanded": "false",
      "aria-controls": id + "-list", autocomplete: "off", autocapitalize: "off", spellcheck: "false", enterkeyhint: "search", placeholder: options.placeholder || "Find an address" });
    const clearButton = el("button", { type: "button", class: "addr-clear", "aria-label": "Clear the address" });
    clearButton.textContent = "×";
    clearButton.hidden = true;
    const list = el("ul", { id: id + "-list", class: "addr-list", role: "listbox", "aria-label": "Addresses" });
    list.hidden = true;
    const line = el("p", { class: "addr-line", role: "status", "aria-live": "polite" });
    field.append(input, clearButton);
    box.append(label, field, list, line);
    let marker = null, gone = false, blurTimer = null;
    const reduced = () => !!root.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    const centre = () => { try { const c = map.getCenter(); return [c.lng, c.lat]; } catch { return null; } };

    function draw(s) {
      if (gone) return;
      if (input.value !== s.text) input.value = s.text;
      clearButton.hidden = !s.text;
      list.replaceChildren(...s.results.map((r, i) => {
        const li = el("li", { id: id + "-o" + i, role: "option", class: "addr-option", "aria-selected": i === s.active ? "true" : "false", "data-i": String(i) });
        const name = el("span", { class: "addr-name" }); name.textContent = r.address;
        li.append(name);
        if (r.locality && !normalise(r.address).includes(normalise(r.locality))) { const where = el("span", { class: "addr-where" }); where.textContent = r.locality; li.append(where); }
        return li;
      }));
      list.hidden = !s.results.length;
      input.setAttribute("aria-expanded", s.results.length ? "true" : "false");
      if (s.active >= 0) { input.setAttribute("aria-activedescendant", id + "-o" + s.active); list.children[s.active]?.scrollIntoView?.({ block: "nearest" }); }
      else input.removeAttribute("aria-activedescendant");
      line.textContent = SAY[s.status] || "";
    }
    const search = createSearch({ run: options.run || rpcRunner(options.sb || root.FP?.sb), near: centre, onChange: draw });

    function dropMarker() { if (marker) { marker.remove(); marker = null; } }
    function go(row) {
      if (!row) return;
      dropMarker();
      const at = [row.longitude, row.latitude];
      if (ML?.Marker) {
        const dot = doc.createElement("div");
        dot.className = "addr-marker";
        dot.setAttribute("aria-hidden", "true");
        marker = new ML.Marker({ element: dot, anchor: "center" }).setLngLat(at).addTo(map);
      }
      const view = { center: at, zoom: Math.max(options.zoom || ZOOM, 0), bearing: map.getBearing?.() ?? 0, pitch: 0, padding: options.padding?.() || undefined };
      if (reduced()) map.jumpTo(view); else map.flyTo({ ...view, duration: 900, essential: false });
      options.onChoose?.(row);
    }
    function clear() { search.clear(); dropMarker(); }

    const on = [];
    const listen = (target, type, f, opts) => { target.addEventListener(type, f, opts); on.push([target, type, f, opts]); };
    listen(input, "input", () => { search.input(input.value); if (!input.value) dropMarker(); });
    listen(input, "keydown", (e) => {
      const did = search.key(e.key);
      if (!did) return;
      e.preventDefault(); e.stopPropagation();          // the box's own Escape never closes what it sits in
      if (did === "choose") go(search.choose());
      if (did === "clear") clear();
    });
    // leaving the box folds the list (after a moment, so a tap on a row still lands)
    listen(input, "blur", () => { root.clearTimeout?.(blurTimer); blurTimer = root.setTimeout?.(() => { blurTimer = null; if (!gone && doc.activeElement !== input) search.close(); }, 150); });
    listen(clearButton, "click", () => { clear(); input.focus(); });
    listen(list, "mousedown", (e) => e.preventDefault());    // a tap on a row keeps the focus in the box
    listen(list, "click", (e) => { const li = e.target.closest?.("[data-i]"); if (li) go(search.choose(Number(li.getAttribute("data-i")))); });
    const host = options.host;
    if (host) host.append(box);
    const onRemove = () => destroy();
    map.on?.("remove", onRemove);

    function destroy() {
      if (gone) return;
      search.destroy();
      if (blurTimer != null) { root.clearTimeout?.(blurTimer); blurTimer = null; }
      dropMarker();
      for (const [target, type, f, opts] of on.splice(0)) target.removeEventListener(type, f, opts);
      map.off?.("remove", onRemove);
      box.remove();
      gone = true;
    }
    return { element: box, input, clear, destroy, search: (text) => { input.value = text; search.input(text); }, state: () => search.state, get marker() { return marker; } };
  }

  return { MIN, MAX, WAIT, ZOOM, SHORT, STREET_TYPES, normalise, searchText, words, rank, nearText, parseNear, createSearch, rpcRunner, attach };
});
