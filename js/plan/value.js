(function (root, factory) {
  const api = factory(typeof module === "object" && module.exports ? require("./provenance.js") : root.FP.plan.provenance);
  if (typeof module === "object" && module.exports) module.exports = api; else root.FP.plan.value = api;
})(typeof window === "undefined" ? globalThis : window, function (P) {
  const { esc, date } = P;
  const empty = () => ({ state: "not_recorded" });
  function number(n) { return Number(n).toLocaleString("en-NZ", { maximumFractionDigits: 3 }); }
  function render(v, ctx, label = "Value", required = true) {
    v = v || empty();
    const mark = ctx.marker(v);
    if (v.state === "not_recorded") return `<span class="value-box ${required ? "required" : "optional"}" data-state="not_recorded"><span class="screen-only">Not yet recorded: ${esc(label)}</span><i class="print-only">Not recorded at ${esc(date(ctx.pdm.as_at))}</i>${mark}</span>`;
    if (v.state === "not_applicable") return `<span class="value-box" data-state="not_applicable">Not applicable: ${esc(v.na_reason || v.note || "reason not recorded")} (${esc(v.assessed_by || P.person(v.checked))}, ${esc(date(v.assessed_on || v.checked?.at))})${mark}</span>`;
    const raw = v.v != null ? number(v.v) : esc(v.text ?? "Value not recorded");
    let qualifier = "";
    if (v.class === "assessment") qualifier = " (" + esc(v.assessed_by || v.shown_as || "assessment author not recorded") + (v.assessed_on ? ", " + esc(date(v.assessed_on)) : "") + ")";
    if (v.class === "interpretation") qualifier = " (" + esc([v.model, v.model_version].filter(Boolean).join(" ") || v.shown_as || "model not recorded") + ")";
    if (v.class === "designation" && ctx.section === "register") qualifier = " (" + esc(v.shown_as || "instrument not recorded") + ")";
    if (v.state === "calculated") qualifier += " <abbr title='Calculated from the recorded inputs'>calc.</abbr>";
    const body = raw + (v.unit ? " " + esc(v.unit) : "") + qualifier;
    if (v.state === "awaiting_check") return `<span class="value-box" data-state="awaiting_check"><span class="screen-only">Awaiting check${ctx.advisor ? ": " + body : ""}</span><i class="print-only">Not yet checked</i>${mark}</span>`;
    return `<span class="plan-value" data-state="${esc(v.state)}" data-fact-id="${esc(v.fact_id)}">${body}${v.flagged ? ' <span class="flag">⚑ ' + esc(v.flag_reason || "Different recorded values") + "</span>" : ""}${v.pinned ? ' <span class="pin">Pinned: ' + esc(v.pin_reason) + "</span>" : ""}${mark}</span>`;
  }
  function fact(pdm, type, item = null, place = null) {
    return (pdm.values || []).find((v) => v.fact_type === type && (v.item ?? null) === item && (v.place_id ?? null) === place && !v.title_nos?.length) || empty();
  }
  function calculated(n, unit, formula, inputs) {
    return n == null || !Number.isFinite(n) ? empty() : { state: "calculated", v: n, unit, calc: { formula, inputs } };
  }
  return { render, fact, empty, calculated, number };
});
