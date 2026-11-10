// The simple view (V6, docs/CONTEXT.md decision 7): a client sees Maps and Files in a farm or group space and nothing else;
// RCL staff (profiles.is_staff, FP.ops.isStaff) see everything. This is a display choice only: every route, screen, table,
// policy and function stays, and what a person may read is still decided by the database's own rules, not by this file.
// Bringing a feature back is one line here: add its view to CLIENT_VIEWS, or its page to CLIENT_PAGES. The router (main.js)
// asks this file about every route, and the navigation draws from the same list.
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else { root.FP = root.FP || {}; root.FP.simpleView = api; }
})(typeof window === "undefined" ? globalThis : window, function (root) {
  // The allow-list. Each space: [view, the word the client reads], in tab order; the first the router knows is the landing.
  // "documents" is the Files store (its route name stays). "maps" is V4's view; until the router knows it, no tab is drawn for it.
  const CLIENT_VIEWS = { farm: [["maps", "Maps"], ["documents", "Files"]], group: [["maps", "Maps"], ["documents", "Files"]] };
  // Pages outside a farm or group a client may open, as their address after "#/" (for example "account/qgis"). None in v1.
  const CLIENT_PAGES = [];

  const SAMPLE = "00000000-0000-4000-8000-000000000000";
  const browserModels = () => ({ farm: root.FP.farmModel, group: root.FP.groupModel });
  // The list as this build's router knows it: a view with no route yet has no tab and is no one's landing.
  const known = (space, models) => CLIENT_VIEWS[space].filter(([key]) => models[space].match(models[space].href(SAMPLE, key))?.view === key);

  // What a client's visit to this address does: { action: "open" } it opens as it stands, { action: "go", href } goes to the
  // space's landing (the bare address of a farm or group), { action: "hidden" } is answered "not available". Anything not
  // on the allow-list is hidden, so a new route is hidden until someone adds it here.
  function decide(hash, models) {
    const h = String(hash || "");
    if (h === "" || h === "#" || h === "#/") return { action: "open" };   // home: the person's farms and groups, or their one place
    for (const space of ["farm", "group"]) {
      const r = models[space].match(h);
      if (!r) continue;
      const id = r[space], list = known(space, models);
      if (r.view === "map") return list.length ? { action: "go", space, id, view: list[0][0], href: models[space].href(id, list[0][0]) } : { action: "hidden", space, id };
      return list.some(([key]) => key === r.view) ? { action: "open", space, id, view: r.view } : { action: "hidden", space, id };
    }
    return CLIENT_PAGES.includes(h.replace(/^#\//, "").split("?")[0]) ? { action: "open" } : { action: "hidden" };
  }

  // ---- in the browser ----------------------------------------------------------------------------------------------------
  // Whether the simple view applies. Fails closed: staff status not read yet, or unreadable, is the simple view.
  // The demo (invented data, no sign-in) keeps every screen unless the address asks for it with ?simple=client|staff|unreadable.
  function on() {
    const FP = root.FP;
    if (FP.demo?.active && !FP.demo.simple) return false;
    return !FP.ops?.isStaff?.();
  }
  const gate = (hash) => decide(hash, browserModels());
  const tabs = (space) => known(space, browserModels());
  const landing = (space) => tabs(space)[0]?.[0] || "documents";
  // The plain page a hidden route answers with: links to this farm's or group's Maps and Files when it is one of the
  // person's, otherwise back to their own farms and groups.
  function notAvailable(decision, places) {
    const FP = root.FP, mine = decision.space && places[decision.space + "s"]?.some((p) => p.id === decision.id);
    const model = decision.space ? browserModels()[decision.space] : null;
    const links = mine ? tabs(decision.space).map(([key, label]) => FP.el("a", { href: FP.href(model.href(decision.id, key)) }, label))
      : [FP.el("a", { href: FP.href("") || "#/" }, "Your maps and files")];
    FP.$("#unavailable-links").replaceChildren(...links.flatMap((a, n) => (n ? [" · ", a] : [a])));
    document.title = "Not available | " + (FP.brand?.product || "");
    FP.show("screen-unavailable");
  }
  return { CLIENT_VIEWS, CLIENT_PAGES, decide, on, gate, tabs, landing, notAvailable };
});
