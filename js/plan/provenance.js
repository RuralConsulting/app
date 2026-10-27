// Pure HTML helpers shared by the renderer and its Node fixtures.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.FP.plan = root.FP.plan || {}).provenance = api;
})(typeof window === "undefined" ? globalThis : window, function () {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const date = (s) => s ? (/^\d{4}-\d{2}-\d{2}/.test(s) ? new Date(s.slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-NZ", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }) : String(s)) : "date not recorded";
  const person = (p) => p?.by_name || p?.user_id || "author not recorded";
  function source(s) {
    if (!s) return "Source not recorded";
    const label = [s.title || s.provider || "Source not recorded", s.author, s.author_org, s.date_prepared && date(s.date_prepared),
      s.status, s.page != null && "p" + s.page, s.title_no, s.valid_from && "loaded " + date(s.valid_from)].filter(Boolean).join(", ");
    return s.storage_path ? `<button type="button" class="document-link" data-document-path="${esc(s.storage_path)}" data-page="${esc(s.page)}">${esc(label)}</button>` : esc(label);
  }
  function detail(v) {
    return [v.shown_as && esc(v.shown_as), v.source ? source(v.source) : "Source not recorded",
      v.method && "Method: " + esc(v.method), v.season && "Season: " + esc(v.season),
      v.as_at && "As at: " + esc(date(v.as_at)), v.checked && "Checked by " + esc(person(v.checked)) + ", " + esc(date(v.checked.at)),
      v.note && esc(v.note), v.calc && "Formula: " + esc(v.calc.formula)].filter(Boolean).join(" · ");
  }
  function context(pdm, section) {
    const notes = [];
    return {
      pdm, section, notes, advisor: !!pdm.viewer?.is_advisor,
      marker(v) {
        const print = detail(v) + (v.calc?.inputs?.length ? " · Inputs: " + v.calc.inputs.map((a) =>
          esc(a.v ?? a.text ?? a.place_id ?? a.title_no ?? "mapped geometry") + " " + esc(a.unit) + " · " + detail(a)).join("; ") : "");
        const key = JSON.stringify([v.fact_id, print]);
        let n = notes.findIndex((x) => x.key === key);
        if (n < 0) { n = notes.length; notes.push({ key, html: print }); }
        const id = `source-${section}-${n + 1}`;
        // Native details works with mouse, touch and keyboard; never relies on hover.
        let extras = "";
        if (this.advisor && v.alternatives?.length) extras += '<div class="advisor-only">Other recorded values: ' +
          v.alternatives.map((a) => esc(a.v ?? a.text ?? "Not recorded") + " " + esc(a.unit) + " — " + detail(a)).join("<br>") + "</div>";
        if (v.calc?.inputs?.length) extras += "<div>Inputs: " + v.calc.inputs.map((a) =>
          esc(a.v ?? a.text ?? a.place_id ?? a.title_no ?? "mapped geometry") + " " + esc(a.unit) + " · " + detail(a)).join("<br>") + "</div>";
        return `<sup class="print-ref"><a href="#${id}">${n + 1}</a></sup><details class="provenance" data-provenance><summary aria-label="Source ${n + 1}">[${n + 1}]</summary><div>${print}${extras}</div></details>`;
      },
      sources() { return notes.length ? '<aside class="source-notes"><h3>Sources</h3><ol>' + notes.map((n, i) => `<li id="source-${section}-${i + 1}">${n.html}</li>`).join("") + "</ol></aside>" : ""; },
    };
  }
  return { esc, date, person, source, detail, context };
});
