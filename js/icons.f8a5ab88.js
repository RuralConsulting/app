// UI1: the app's few icons, drawn here as simple line icons on a 24 px grid (no icon library, no files to fetch). Every icon is
// stroked in the text colour (currentColor), 1.75 px, round caps and joins, so it sits with the words beside it in both themes.
// FP.icon(name) returns an <svg> that screen readers skip (aria-hidden); the control around it carries the words.
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else { root.FP = root.FP || {}; root.FP.icons = api; root.FP.icon = api.icon; }
})(typeof window === "undefined" ? globalThis : window, function (root) {
  // Each icon: the path data of its strokes (one string; several sub-paths are fine)
  const PATHS = {
    plus: "M12 5v14M5 12h14",
    close: "M6 6l12 12M18 6L6 18",
    back: "M15 5l-7 7 7 7",
    chevron: "M9 6l6 6-6 6",
    down: "M6 9l6 6 6-6",
    file: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h4",
    files: "M4 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z",
    event: "M5 6h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM4 10h16M8 3v4M16 3v4M12 13v4M10 15h4",
    events: "M5 6h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM4 10h16M8 3v4M16 3v4M8 14h2M14 14h2M8 17h2",
    maps: "M9 4L3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14",
    map: "M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
    due: "M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2 2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2zM9 13l2 2 4-4",
    ask: "M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12zM9.5 9.5a2.5 2.5 0 1 1 3.3 2.4c-.5.2-.8.6-.8 1.1M12 16h.01",
    create: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z",
    manage: "M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4",
    people: "M16 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 20v-1a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
    person: "M20 21v-1a5 5 0 0 0-5-5H9a5 5 0 0 0-5 5v1M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
    note: "M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12zM8.5 10.5h7M8.5 14h4",
    search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4",
    lock: "M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1zM8 11V7a4 4 0 0 1 8 0v4",
    shield: "M12 3l7 3v6c0 4.5-3 7.7-7 9-4-1.3-7-4.5-7-9V6z",
    signout: "M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H3",
    ops: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
    layers: "M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 17.5l9 5 9-5",
    places: "M4 10.5L12 4l8 6.5V19a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z",
  };
  // The icon each space view shows in the tab bar
  const VIEW_ICONS = { map: "due", maps: "maps", documents: "files", events: "events", ask: "ask", create: "create", manage: "manage", people: "people", onboarding: "due" };
  const NS = "http://www.w3.org/2000/svg";
  function icon(name, size = 22) {
    const d = PATHS[name] || PATHS.file, doc = root.document;
    const svg = doc.createElementNS(NS, "svg");
    for (const [k, v] of Object.entries({ viewBox: "0 0 24 24", width: size, height: size, fill: "none", stroke: "currentColor", "stroke-width": "1.75",
      "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", focusable: "false", class: "icon icon-" + name })) svg.setAttribute(k, String(v));
    const path = doc.createElementNS(NS, "path");
    path.setAttribute("d", d);
    svg.append(path);
    return svg;
  }
  const forView = (key) => VIEW_ICONS[key] || "file";
  // A space's monogram (its mark when it has no logo): two letters, the same rule for farms and groups. Bracketed words such as
  // "(example)" and punctuation are left out; two or more words give their first letters ("Example Downs" ED), one word its first
  // two ("HDLG (example)" HD); nothing readable gives none.
  // Letters are counted as a reader sees them (NFC first, then whole characters: a macron typed as a separate mark stays with its
  // letter, and a letter outside the Basic Multilingual Plane is never split). A name with no letters or digits gives "" (the
  // header then shows a neutral place glyph instead).
  const chars = (word) => (typeof Intl === "object" && Intl.Segmenter ? [...new Intl.Segmenter("en-NZ", { granularity: "grapheme" }).segment(word)].map((s) => s.segment) : Array.from(word));
  function monogram(name) {
    const words = String(name || "").normalize("NFC").replace(/\([^)]*\)|\[[^\]]*\]/g, " ").replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ").trim().split(/\s+/)
      .map((w) => w.replace(/^\p{M}+/u, "")).filter(Boolean);
    const letters = words.length > 1 ? chars(words[0])[0] + chars(words[1])[0] : chars(words[0] || "").slice(0, 2).join("");
    return letters.toLocaleUpperCase("en-NZ").normalize("NFC");
  }
  return { PATHS, VIEW_ICONS, icon, forView, monogram, names: Object.keys(PATHS) };
});
