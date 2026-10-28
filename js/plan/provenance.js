// Pure HTML helpers shared by the renderer and its Node fixtures.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.FP.plan = root.FP.plan || {}).provenance = api;
})(typeof window === "undefined" ? globalThis : window, function () {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const date = (s) => s ? (/^\d{4}-\d{2}-\d{2}/.test(s) ? new Date(s.slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-NZ", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }) : String(s)) : "date not recorded";
  const person = (p) => p?.by_name || p?.user_id || "author not recorded";
  function source(s, omitMissing = false) {
    if (!s) return "Source not recorded";
    const label = [s.title || s.provider || (!omitMissing && "Source not recorded"), s.author, s.author_org, s.date_prepared && date(s.date_prepared),
      s.status && String(s.status).replaceAll("_", " "), s.page != null && "p" + s.page, s.title_no, s.valid_from && "loaded " + date(s.valid_from)].filter(Boolean).join(", ");
    return s.storage_path ? `<button type="button" class="document-link" data-document-path="${esc(s.storage_path)}" data-page="${esc(s.page)}">${esc(label)}</button>` : esc(label);
  }
  function detail(v, labels, omitMissing = false) {
    const sourceFields = ["title", "provider", "author", "author_org", "date_prepared", "status", "page", "title_no", "valid_from"];
    const hasSource = v.source && sourceFields.some((key) => v.source[key] != null && v.source[key] !== "");
    const sourceLine = hasSource ? source(v.source, omitMissing) : !omitMissing && "Source not recorded";
    const checker = v.checked?.by_name || v.checked?.user_id;
    const checkedLine = checker ? "Checked by " + esc(checker) + (v.checked.at ? ", " + esc(date(v.checked.at)) : "") : !omitMissing && "Checked by not yet recorded";
    return [v.shown_as && esc(v.shown_as), sourceLine,
      v.method ? "Method: " + esc(labels?.enumLabel("fact_method", v.method) || v.method) : !omitMissing && "Method: not recorded", v.season && "Season: " + esc(v.season),
      v.as_at && "As at: " + esc(date(v.as_at)), checkedLine,
      v.note && esc(v.note), v.calc && "Formula: " + esc(v.calc.formula)].filter(Boolean).join(" · ");
  }
  // One collector for the whole document, including values repeated in different sections.
  function context(pdm, section, notes = [], labels) {
    return {
      pdm, section, notes, labels, advisor: !!pdm.viewer?.is_advisor,
      marker(v, body, printBody = body) {
        const inputs = v.calc?.inputs?.length ? " · Inputs: " + v.calc.inputs.map((a) =>
          esc(a.v ?? a.text ?? a.title_no ?? "mapped geometry") + " " + esc(a.unit) + " · " + detail(a, labels, !this.advisor)).join("; ") : "";
        const print = detail(v, labels, !this.advisor) + inputs;
        const key = JSON.stringify([v.fact_id, print]);
        let n = notes.findIndex((x) => x.key === key);
        if (n < 0) { n = notes.length; notes.push({ key, html: print }); }
        const id = `source-${n + 1}`;
        let extras = "";
        if (this.advisor && v.alternatives?.length) extras += '<div class="advisor-only">Other recorded values: ' +
          v.alternatives.map((a) => esc(a.v ?? a.text ?? "Not recorded") + " " + esc(a.unit) + " — " + detail(a, labels)).join("<br>") + "</div>";
        // The controller opens this inert source card in a native dialog. The value is its keyboard/touch trigger.
        const trigger = body || '<span aria-hidden="true">ⓘ</span><span class="sr-only">Show source</span>';
        return `<span class="print-value">${printBody || ""}</span><sup class="print-ref"><a href="#${id}">${n + 1}</a></sup><span class="provenance${body ? "" : " source-note"}" data-provenance><button type="button" class="source-value" data-source-open title="Show source">${trigger}</button><template><div class="source-card"><p>${print}</p>${extras}</div></template></span>`;
      },
      sources() { return notes.length ? '<aside class="source-notes"><h3>Numbered references</h3><ol>' + notes.map((n, i) => `<li id="source-${i + 1}">${n.html}</li>`).join("") + "</ol></aside>" : ""; },
    };
  }
  return { esc, date, person, source, detail, context };
});

