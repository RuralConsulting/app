// Access keys for QGIS (QGIS1a, #456): route #/account/qgis, the person's own page (reached from Change password). Make a key
// (a name and how long it lasts), see it once with a Copy button and the QGIS steps, and list and revoke your keys. Every key is
// the signed-in person's own: the database makes it for them alone (public.personal_access_token_issue), lists their own rows
// (row-level security) and revokes only theirs (public.personal_access_token_revoke). The rules are js/tokens-model.js.
(function () {
  const K = FP.tokensModel, { $ } = FP;
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  let token = 0, list = [], confirming = null, me = null;

  const url = () => K.serviceUrl(window.FP_CONFIG?.supabaseUrl);

  function shell() {
    return "<h1>Access keys for QGIS</h1>" +
      '<p class="help">QGIS reads your farms\' and groups\' layers with an access key. It sees exactly what you see in the app, read-only. ' +
      "Treat a key like a password: anyone who has it can read what you can. Revoke a key you no longer use.</p>" +
      '<form id="f-token" novalidate>' +
      '<label for="tk-name">Name</label>' +
      '<input id="tk-name" maxlength="80" autocomplete="off" placeholder="QGIS on my laptop" required>' +
      '<label for="tk-days">Lasts</label>' +
      '<select id="tk-days">' + K.DAYS.map(([d, label]) => '<option value="' + d + '"' + (d === K.DEFAULT_DAYS ? " selected" : "") + ">" + esc(label) + "</option>").join("") + "</select>" +
      '<button type="submit">Make a key</button>' +
      "</form>" +
      '<p id="tk-msg" class="msg" role="status"></p>' +
      '<section id="tk-new" class="token-new" hidden aria-live="polite"></section>' +
      '<h2 class="token-heading">Your keys</h2>' +
      '<ul id="tk-list" class="token-list" aria-live="polite"><li class="token-wait">Reading your keys…</li></ul>' +
      '<p class="fine">The service\'s address for QGIS: <code id="tk-url">' + esc(url()) + "</code></p>" +
      '<p class="fine"><a id="tk-back" href="' + esc(FP.href("")) + '">Back to the map</a></p>';
  }

  function renderList() {
    const rows = K.rows(list);
    const box = $("#tk-list");
    if (!box) return;
    if (!rows.length) { box.innerHTML = '<li class="token-wait">No keys yet.</li>'; return; }
    box.innerHTML = rows.map((r) => '<li data-token="' + esc(r.id) + '" data-state="' + r.state + '">' +
      '<div class="tk-head"><b>' + esc(r.name) + '</b><span class="tk-state">' + esc(r.stateWords) + "</span></div>" +
      "<small>" + esc(r.hint) + " · " + esc(r.line) + "</small>" +
      (!r.revocable ? "" : confirming === r.id
        ? '<p class="tk-confirm">QGIS stops reading with this key at once. Revoke it? <button type="button" class="tk-revoke-yes">Yes, revoke it</button> <button type="button" class="link tk-revoke-no">Cancel</button></p>'
        : '<p class="tk-actions"><button type="button" class="link tk-revoke">Revoke</button></p>') +
      "</li>").join("");
  }

  // The new key, shown once: the value, Copy, and the QGIS steps. Leaving the page clears it.
  function showNew(t) {
    const box = $("#tk-new");
    box.hidden = false;
    box.innerHTML = "<p><b>Your new key, " + esc(t.name) + "</b>. Copy it now: it is shown only this once.</p>" +
      '<div class="token-value"><input id="tk-value" readonly aria-label="Your new access key" value="' + esc(t.token) + '"><button type="button" id="tk-copy">Copy</button></div>' +
      '<p class="fine" id="tk-copied" role="status"></p>' +
      '<ol class="token-steps">' + K.qgisSteps(url()).map((s) => "<li>" + esc(s) + "</li>").join("") + "</ol>" +
      '<p class="fine">It lasts until ' + esc(K.day(t.expires_at)) + '. Step by step: <a href="' + esc(K.DOCS_URL) + '" target="_blank" rel="noopener">Connecting QGIS</a>.</p>';
  }

  async function copy() {
    const input = $("#tk-value");
    if (!input) return;
    let done = false;
    try { await navigator.clipboard.writeText(input.value); done = true; } catch {
      try { input.select(); done = document.execCommand("copy"); } catch { done = false; }
    }
    $("#tk-copied").textContent = done ? "Copied. Paste it into QGIS's API Header value." : "Select the key and copy it yourself.";
  }

  async function read(mine) {
    const { data, error } = await FP.sb.from("personal_access_tokens").select(K.COLUMNS).eq("user_id", mine).order("created_at", { ascending: false }).limit(200);
    if (error) throw error;
    return data || [];
  }

  async function make(ev) {
    ev.preventDefault();
    const msg = $("#tk-msg"), name = K.checkName($("#tk-name").value);
    msg.classList.remove("ok");
    if (!name.ok) { msg.textContent = name.error; return; }
    const btn = ev.target.querySelector("button[type=submit]");
    btn.disabled = true; msg.textContent = "Making the key…";
    const call = K.issueCall(name.text, K.checkDays($("#tk-days").value));
    let res;
    try { res = await FP.sb.rpc(call.fn, call.args); } catch (e) { res = { error: e }; }
    btn.disabled = false;
    if (res?.error || !res?.data?.token) { msg.textContent = K.refusal(res?.error || { message: "no key came back" }); return; }
    msg.classList.add("ok"); msg.textContent = "Key made.";
    $("#tk-name").value = "";
    showNew(res.data);
    const { token: _shown, ...row } = res.data;   // the list never holds the key itself
    list = [row, ...list.filter((x) => x.id !== row.id)];
    renderList();
  }

  async function revoke(id) {
    const msg = $("#tk-msg"), call = K.revokeCall(id);
    msg.classList.remove("ok"); msg.textContent = "Revoking…";
    let res;
    try { res = await FP.sb.rpc(call.fn, call.args); } catch (e) { res = { error: e }; }
    confirming = null;
    if (res?.error || !res?.data) { msg.textContent = K.refusal(res?.error || { message: "no answer" }); renderList(); return; }
    list = list.map((x) => (x.id === id ? { ...x, ...res.data } : x));
    msg.classList.add("ok"); msg.textContent = "Revoked. QGIS can no longer read with that key.";
    renderList();
  }

  const wired = new WeakSet();
  function wire(card) {
    if (wired.has(card)) return;
    wired.add(card);
    card.addEventListener("submit", (e) => { if (e.target.id === "f-token") make(e); });
    card.addEventListener("click", (e) => {
      const b = e.target.closest?.("button");
      if (!b) return;
      const id = b.closest("[data-token]")?.dataset.token;
      if (b.id === "tk-copy") copy();
      else if (b.classList.contains("tk-revoke")) { confirming = id; renderList(); }
      else if (b.classList.contains("tk-revoke-no")) { confirming = null; renderList(); }
      else if (b.classList.contains("tk-revoke-yes") && id) revoke(id);
    });
  }

  async function open() {
    const current = ++token, card = $("#tokens-card");
    document.body.classList.remove("farm-space-active", "farm-detail", "portfolio-active");
    FP.show("screen-tokens");
    document.title = "Access keys for QGIS | " + FP.brand?.product;
    confirming = null; list = [];
    card.innerHTML = shell();
    wire(card);
    try {
      me = me || (await FP.auth.user())?.id || null;
      const rows = await read(me);
      if (current !== token) return;
      list = rows; renderList();
    } catch (e) {
      if (current === token) $("#tk-list").innerHTML = '<li class="token-wait" role="alert">' + esc(K.refusal(e)) + "</li>";
    }
  }
  // Leaving the page: the new key (shown once) is cleared from the page.
  function close() {
    token++;
    const box = document.querySelector("#tk-new");
    if (box) { box.innerHTML = ""; box.hidden = true; }
  }

  FP.tokens = { open, close, state: () => ({ keys: list.length, confirming }) };
})();
