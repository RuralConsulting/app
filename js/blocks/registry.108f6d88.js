// The block contract (docs/BUILDING-BLOCKS.md §2). Every block is one module in this folder, defined once:
//   { id, title?, empty, options: {name: {type, default, values?, min?, max?}}, state(data), render(data, options, ctx), mounted? }
// state(data) says "full", "sparse" or "empty"; render is pure (data in, HTML text out) and draws every state,
// empty included, under a heading of ctx.level; mounted(host, data, options, ctx) is only for blocks that drive a
// live surface (the map). Hosts mount a block with render(el, { block, owner, query, options }, ctx): options are
// checked against the block's schema and the query against one declarative grammar, and anything unknown is
// refused with a BlockError rather than ignored. Blocks never read: the host's ctx.read(query, owner) does.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else { root.FP = root.FP || {}; root.FP.blocks = api; }
})(typeof window === "undefined" ? globalThis : window, function () {
  const STATES = ["full", "sparse", "empty"];
  const DEFINITION = ["id", "title", "empty", "options", "state", "render", "mounted"];
  const SPEC = ["block", "owner", "query", "options"];
  // What a block may ask for: record kinds, types, tags, a place, a period, a sort and a limit. Names only, never
  // free text, so nothing a person or the AI types can become a read.
  const TOKEN = /^[A-Za-z0-9_:.-]{1,80}$/, DAY = /^\d{4}-\d{2}-\d{2}$/;
  const QUERY = ["kinds", "types", "tags", "place", "period", "sort", "limit"];
  const MAX_LIMIT = 5000;
  const TYPES = ["boolean", "string", "integer", "enum", "list"];

  class BlockError extends Error { constructor(message) { super(message); this.name = "BlockError"; } }
  const fail = (message) => { throw new BlockError(message); };
  const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const names = (list) => list.length ? list.join(", ") : "none";
  const unknown = (given, allowed) => Object.keys(given).filter((k) => !allowed.includes(k));

  // One option value against its schema entry. A null default makes the option optional (null = not set).
  function check(where, name, s, v) {
    if (v === undefined) return Array.isArray(s.default) ? [...s.default] : s.default;
    if (v === null && s.default === null) return null;
    const bad = (what) => fail(where + ': option "' + name + '" must be ' + what);
    if (s.type === "boolean" && typeof v !== "boolean") bad("true or false");
    if (s.type === "string" && typeof v !== "string") bad("text");
    if (s.type === "integer" && (!Number.isInteger(v) || (s.min != null && v < s.min) || (s.max != null && v > s.max)))
      bad("a whole number" + (s.min != null && s.max != null ? " from " + s.min + " to " + s.max : ""));
    if (s.type === "enum" && !s.values.includes(v)) bad("one of: " + s.values.join(", "));
    if (s.type === "list") {
      if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) bad("a list of names");
      const odd = s.values ? v.filter((x) => !s.values.includes(x)) : [];
      if (odd.length) bad("a list from: " + s.values.join(", ") + " (not " + odd.join(", ") + ")");
      return [...v];
    }
    return v;
  }

  function checkSchema(id, schema) {
    if (!isObject(schema)) fail('Block "' + id + '": options must be a schema object');
    for (const [name, s] of Object.entries(schema)) {
      if (!isObject(s) || !TYPES.includes(s.type)) fail('Block "' + id + '": option "' + name + '" needs a type (' + TYPES.join(", ") + ")");
      if (s.type === "enum" && (!Array.isArray(s.values) || !s.values.length)) fail('Block "' + id + '": option "' + name + '" lists no values');
      if (!("default" in s)) fail('Block "' + id + '": option "' + name + '" has no default');
      if (s.default !== null) check('Block "' + id + '"', name, s, s.default);
    }
  }

  function query(given) {
    if (given == null) return {};
    if (!isObject(given)) fail("A block query must be an object of " + QUERY.join(", "));
    const odd = unknown(given, QUERY);
    if (odd.length) fail('Unknown query "' + odd[0] + '". A block query may name only: ' + QUERY.join(", "));
    const out = {};
    for (const [k, v] of Object.entries(given)) {
      if (v == null) continue;
      if (["kinds", "types", "tags"].includes(k)) {
        if (!Array.isArray(v) || !v.every((x) => typeof x === "string" && TOKEN.test(x))) fail('Query "' + k + '" must be a list of names');
        out[k] = [...v];
      } else if (k === "place" || k === "sort") {
        if (typeof v !== "string" || !TOKEN.test(v)) fail('Query "' + k + '" must be a name');
        out[k] = v;
      } else if (k === "period") {
        if (!isObject(v) || unknown(v, ["from", "to"]).length || ![v.from, v.to].every((d) => d == null || (typeof d === "string" && DAY.test(d))) || (v.from && v.to && v.from > v.to))
          fail('Query "period" must be { from, to } as YYYY-MM-DD dates, from before to');
        out.period = { from: v.from ?? null, to: v.to ?? null };
      } else if (k === "limit") {
        if (!Number.isInteger(v) || v < 1 || v > MAX_LIMIT) fail('Query "limit" must be a whole number from 1 to ' + MAX_LIMIT);
        out.limit = v;
      }
    }
    return out;
  }

  const visible = (html) => html.replace(/<[^>]*>/g, "").replace(/&[a-z#0-9]+;/gi, "x").trim().length > 0;
  const level = (ctx) => Math.min(Math.max(Number(ctx?.level) || 2, 1), 5);
  // The designed empty state every block falls back to: never a blank space.
  const emptyHtml = (block, data, n, text = block.empty) => '<section class="block-empty"><h' + n + ' class="block-title">' +
    esc((isObject(data) && typeof data.title === "string" && data.title) || block.title) + "</h" + n + "><p>" + esc(text) + "</p></section>";
  const loadingHtml = () => '<div class="block-loading" role="status"><span class="visually-hidden">Loading</span><i></i><i></i><i></i></div>';

  function createRegistry() {
    const blocks = new Map();
    function define(def) {
      if (!isObject(def)) fail("A block definition must be an object");
      const id = def.id;
      if (typeof id !== "string" || !/^[a-z][a-z0-9-]*$/.test(id)) fail("A block needs an id of lower-case letters, digits and dashes");
      if (blocks.has(id)) fail('Block "' + id + '" is already defined');
      const odd = unknown(def, DEFINITION);
      if (odd.length) fail('Block "' + id + '": unknown definition key "' + odd[0] + '"');
      if (def.title != null && (typeof def.title !== "string" || !def.title.trim())) fail('Block "' + id + '": title must be text');
      if (typeof def.empty !== "string" || !def.empty.trim()) fail('Block "' + id + '" needs its empty sentence');
      for (const fn of ["state", "render"]) if (typeof def[fn] !== "function") fail('Block "' + id + '" needs ' + fn + "()");
      if (def.mounted != null && typeof def.mounted !== "function") fail('Block "' + id + '": mounted must be a function');
      const schema = def.options || {};
      checkSchema(id, schema);
      const title = def.title || id.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
      const block = Object.freeze({ ...def, title, options: Object.freeze({ ...schema }) });
      blocks.set(id, block);
      return block;
    }
    function get(id) {
      const block = blocks.get(id);
      if (!block) fail('Unknown block "' + id + '". Blocks: ' + names([...blocks.keys()]));
      return block;
    }
    const list = () => [...blocks.keys()];
    function options(id, given) {
      const block = get(id), schema = block.options;
      if (given != null && !isObject(given)) fail('Block "' + id + '": options must be an object');
      const odd = unknown(given || {}, Object.keys(schema));
      if (odd.length) fail('Block "' + id + '" has no option "' + odd[0] + '". Its options are: ' + names(Object.keys(schema)));
      return Object.fromEntries(Object.entries(schema).map(([name, s]) => [name, check('Block "' + id + '"', name, s, (given || {})[name])]));
    }
    function state(id, data) {
      const s = data == null ? "empty" : get(id).state(data);
      if (!STATES.includes(s)) fail('Block "' + id + '" gave state "' + s + '"; a state is one of ' + STATES.join(", "));
      return s;
    }
    // Pure: the block's HTML for this data and these options, with the state it is in. Used by hosts and tests.
    function html(id, data, given, ctx = {}) {
      const block = get(id), opts = options(id, given), s = state(id, data), n = level(ctx);
      let out = block.render(data, opts, { ...ctx, state: s, level: n });
      if (typeof out !== "string") fail('Block "' + id + '" must render HTML text');
      if (!visible(out)) out = emptyHtml(block, data, n);
      return { html: out, state: s, options: opts };
    }

    // Mount a block in an element: render(el, { block, owner, query, options }, { read, level, ... }).
    // Data read synchronously is drawn at once; a promise shows the loading state first.
    // Returns { block, state, api, ready, refresh(), destroy() }; ready resolves with what mounted() returned.
    function render(el, spec, ctx = {}) {
      if (!isObject(spec)) fail("A block needs a spec: { block, owner, query, options }");
      const odd = unknown(spec, SPEC);
      if (odd.length) fail('Unknown block setting "' + odd[0] + '". A block takes: ' + SPEC.join(", "));
      const block = get(spec.block), opts = options(block.id, spec.options), q = query(spec.query), n = level(ctx);
      let generation = 0, destroyed = false, cleanups = [];
      const handle = { block: block.id, state: "loading", api: null, ready: null, refresh, destroy };
      const set = (s) => { handle.state = s; el.setAttribute("data-block-state", s); };
      const cleanup = () => { for (const f of cleanups.splice(0).reverse()) { try { f(); } catch { /* keep tearing down */ } } };
      el.setAttribute("data-block", block.id);
      function draw(data, mine) {
        const out = html(block.id, data, opts, { ...ctx, level: n });
        el.removeAttribute("aria-busy"); el.innerHTML = out.html; set(out.state);
        if (!block.mounted) return null;
        return block.mounted(el, data, opts, { ...ctx, state: out.state, level: n, owner: spec.owner ?? null, query: q,
          onDestroy: (f) => cleanups.push(f), stale: () => destroyed || mine !== generation });
      }
      function broken(e) {
        el.removeAttribute("aria-busy"); el.innerHTML = emptyHtml(block, null, n, "This couldn't be read."); set("error");
        return Promise.reject(e);
      }
      function run() {
        const mine = ++generation;
        cleanup();
        let data;
        try { data = typeof ctx.read === "function" ? ctx.read(q, spec.owner ?? null) : undefined; } catch (e) { return broken(e); }
        if (data && typeof data.then === "function") {
          el.setAttribute("aria-busy", "true"); el.innerHTML = loadingHtml(); set("loading");
          return data.then((d) => (destroyed || mine !== generation ? null : draw(d, mine)), broken);
        }
        let out;
        try { out = draw(data, mine); } catch (e) { return broken(e); }
        return Promise.resolve(out).catch((e) => (mine === generation && !destroyed ? broken(e) : Promise.reject(e)));
      }
      function refresh() {
        if (destroyed) return Promise.resolve(null);
        handle.ready = run().then((api) => (handle.api = api ?? null));
        handle.ready.catch(() => {});   // the block already shows its error state; a host that awaits ready still sees the failure
        return handle.ready;
      }
      function destroy() {
        if (destroyed) return;
        destroyed = true; generation++; cleanup();
        el.innerHTML = ""; el.removeAttribute("data-block"); el.removeAttribute("data-block-state"); el.removeAttribute("aria-busy");
      }
      refresh();
      return handle;
    }
    return { define, get, list, options, query, state, html, render };
  }

  return { ...createRegistry(), createRegistry, BlockError, STATES, QUERY, MAX_LIMIT };
});
