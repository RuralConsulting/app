// Ask: a question to the farm's Ask function, and its answer as the farm space shows it. The function reads the farm
// as the signed-in person and answers from what the database holds; nothing here calls a model or holds a key. What
// comes back is kept to the shapes the app knows: text, sources (a document or a condition), the map verbs the farm
// space runs after the answer is shown, and confirmations the person can make. Pure, apart from request().
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api; else root.FP.ask = api;
})(typeof window === "undefined" ? globalThis : window, function () {
  const UNAVAILABLE = "Ask isn't available yet.";
  const list = (v) => (Array.isArray(v) ? v : []);
  const str = (v) => typeof v === "string" && v.trim() !== "";
  const SETS = ["quiet", "fep", "photos", "water", "consents", "all"];
  const uiOk = (a) => !!a && ((a.verb === "map.frame" && str(a.place)) || (a.verb === "map.layers" && SETS.includes(a.set)) || (a.verb === "plan.open" && str(a.document_id)));
  const confirmOk = (c) => !!c && str(c.obligation_id) && str(c.label) && (c.verb === "obligation.done" || (c.verb === "document.attach" && str(c.document_id)));
  const sourceOk = (s) => !!s && (s.kind === "obligation" || s.kind === "document") && str(s.id) && str(s.label);

  // The function's reply, made safe to show: anything not in a known shape is dropped.
  function reply(data) {
    if (!data || typeof data !== "object") return { kind: "unavailable", message: UNAVAILABLE };
    if (data.refused) return { kind: "refused", message: str(data.message) ? data.message : "That can't be answered here." };
    return { kind: "answer", text: typeof data.answer_text === "string" ? data.answer_text.trim() : "", sources: list(data.sources).filter(sourceOk),
      ui: list(data.ui_actions).filter(uiOk), confirmations: list(data.confirmations).filter(confirmOk), notes: list(data.notes).filter(str) };
  }
  // A function that isn't deployed (404), is down or can't be reached says one line; its own refusal of the request
  // (sign-in, a malformed question, the model not answering) says what it said.
  async function request(sb, farm, question) {
    let res;
    try { res = await sb.functions.invoke("ask", { body: { farm_id: farm, question } }); } catch { return { kind: "unavailable", message: UNAVAILABLE }; }
    if (!res.error) return reply(res.data);
    const status = res.error.context?.status;
    let body = null;
    try { body = await res.error.context.json(); } catch {}
    return status && status !== 404 && body && str(body.error) ? { kind: "error", message: body.error } : { kind: "unavailable", message: UNAVAILABLE };
  }
  // The answer text as paragraphs and lists: a line starting "- " is a list item; a blank line ends a paragraph.
  function blocks(text) {
    const out = [];
    for (const raw of String(text || "").split("\n")) {
      const line = raw.trim(), item = line.match(/^[-•*]\s+(.*)$/);
      if (!line) { out.push(null); continue; }
      const last = out[out.length - 1];
      if (item) { if (last?.type === "list") last.items.push(item[1]); else out.push({ type: "list", items: [item[1]] }); }
      else if (last?.type === "p") last.text += " " + line;
      else out.push({ type: "p", text: line });
    }
    return out.filter(Boolean);
  }
  return { UNAVAILABLE, SETS, reply, request, blocks };
});
