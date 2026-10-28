(function (root, factory) {
  const api = factory(typeof module === "object" && module.exports ? require("./provenance.js") : root.FP.plan.provenance);
  if (typeof module === "object" && module.exports) module.exports = api; else root.FP.plan.value = api;
})(typeof window === "undefined" ? globalThis : window, function (P) {
  const { esc, date } = P;
  const empty = () => ({ state: "not_recorded" });
  function number(n) { return Number(n).toLocaleString("en-NZ", { maximumFractionDigits: 3 }); }
  function render(v, ctx, label = "Value", required = true) {
    v = v || empty();
    if (v.state === "not_recorded" && !required) return "";
    const mark = (body, printBody) => ctx.marker(v, body, printBody);
    if (v.state === "not_recorded") return `<span class="value-box ${required ? "required" : "optional"}" data-state="not_recorded">${mark(`<span class="missing-chip" title="${esc(label)}">Not yet recorded<span class="sr-only">: ${esc(label)}</span></span>`)}</span>`;
    if (v.state === "not_applicable") return `<span class="value-box" data-state="not_applicable">${mark(`Not applicable: ${esc(v.na_reason || v.note || "reason not recorded")} (${esc(v.assessed_by || P.person(v.checked))}, ${esc(date(v.assessed_on || v.checked?.at))})`)}</span>`;
    const raw = v.v != null ? number(v.v) : esc(v.text != null && v.fact_type === "overall_risk_significance" ? (ctx.labels?.enumLabel("risk_rating", v.text) || v.text) : v.text ?? "Value not recorded");
    let qualifier = "";
    if (v.class === "assessment") qualifier = " (" + esc(v.assessed_by || v.shown_as || "assessment author not recorded") + (v.assessed_on ? ", " + esc(date(v.assessed_on)) : "") + ")";
    if (v.class === "interpretation") qualifier = " (" + esc([v.model, v.model_version].filter(Boolean).join(" ") || v.shown_as || "model not recorded") + ")";
    if (v.class === "designation" && ctx.section === "register") qualifier = " (" + esc(v.shown_as || "instrument not recorded") + ")";
    if (v.state === "calculated") qualifier += " <abbr title='Calculated from the recorded inputs'>calculated</abbr>";
    const body = raw + (v.unit ? " " + esc(ctx.labels?.unit(v.unit) ?? v.unit) : "") + qualifier;
    if (v.state === "awaiting_check") return `<span class="value-box" data-state="awaiting_check">${mark("Awaiting check" + (ctx.advisor ? ": " + body : ""), '<i class="print-only">Not yet checked</i>')}</span>`;
    return `<span class="plan-value" data-state="${esc(v.state)}" data-fact-id="${esc(v.fact_id)}">${mark(body)}${v.flagged ? ' <span class="flag">⚑ ' + esc(v.flag_reason || "Different recorded values") + "</span>" : ""}${v.pinned ? ' <span class="pin">Pinned: ' + esc(v.pin_reason) + "</span>" : ""}</span>`;
  }
  function fact(pdm, type, item = null, place = null) {
    return (pdm.values || []).find((v) => v.fact_type === type && (v.item ?? null) === item && (v.place_id ?? null) === place && !v.title_nos?.length) || empty();
  }
  function calculated(n, unit, formula, inputs) {
    return n == null || !Number.isFinite(n) ? empty() : { state: "calculated", v: n, unit, calc: { formula, inputs } };
  }
  return { render, fact, empty, calculated, number };
});


