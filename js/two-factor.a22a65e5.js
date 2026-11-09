// Two-factor sign-in for RCL staff (V2), after the password and before the app: an authenticator-app code, enrolled on first
// sign-in, as the map portal does it (repo rcl-map-portal, portal/portal.js). Clients are never asked. This page is a courtesy:
// the rule is in the database (app.can_publish_maps needs an aal2 session), so a staff member let in without a code can use the
// app but cannot publish. That is why anything going wrong here, TOTP being off in Supabase above all, never keeps staff out.
FP.twoFactor = (() => {
  const { $, sb } = FP;
  const OFF = "Two-factor sign-in isn't switched on yet. You can carry on, but publishing maps stays closed until it is.";
  const FAILED = "Two-factor sign-in couldn't start just now. You can carry on, but you can't publish maps until you've entered a code. Reload the page to try again.";
  let up = false, factorId = null, finish = null;

  const isOff = (error) => /not[_ ]enabled|disabled/i.test(`${error?.code || ""} ${error?.message || ""}`);
  const unavailable = (error) => ({ kind: "unavailable", message: isOff(error) ? OFF : FAILED });

  // What this staff session needs next: nothing (already aal2), a code for its verified factor, or a new factor to enrol.
  async function step() {
    try {
      const { data: level, error: e1 } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
      if (e1) return unavailable(e1);
      if (level?.currentLevel === "aal2") return { kind: "none" };
      const { data, error: e2 } = await sb.auth.mfa.listFactors();
      if (e2 || !data) return unavailable(e2);
      const verified = (data.totp || []).filter((f) => f.status === "verified");
      if (verified.length) return { kind: "code", factorId: verified[0].id };
      // a setup left half-done (the page was closed) blocks a new one: clear it first
      for (const f of (data.all || []).filter((x) => x.factor_type === "totp" && x.status !== "verified")) await sb.auth.mfa.unenroll({ factorId: f.id });
      const { data: made, error: e3 } = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: "RCL authenticator", issuer: "RCL farm platform" });
      if (e3 || !made) return unavailable(e3);
      return { kind: "enrol", factorId: made.id, qr: made.totp.qr_code, secret: made.totp.secret };
    } catch (e) { return unavailable(e); }
  }

  // null when the code was right; otherwise what to say, and whether the feature itself is off.
  async function verify(id, typed) {
    const code = String(typed || "").replace(/\s/g, "");
    if (!/^\d{6}$/.test(code)) return { message: "Type the 6 digits your app shows." };
    try {
      const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: id, code });
      if (!error) return null;
      if (isOff(error)) return { off: true, message: OFF };
      if (error.status === 429) return { message: "Too many attempts. Wait a few minutes and try again." };
      return { message: "That code didn't work. Codes change every 30 seconds: type the one showing now." };
    } catch { return { message: "Couldn't check that code. Check your connection and try again." }; }
  }

  function draw(s) {
    FP.show("screen-two-factor");
    factorId = s.factorId || null;
    $("#tf-enrol").hidden = s.kind !== "enrol";
    $("#tf-ask").hidden = $("#tf-lost").hidden = s.kind !== "code";
    $("#f-two-factor").hidden = !factorId;
    $("#f-tf-continue").hidden = !!factorId;
    $("#tf-msg").textContent = s.message || "";
    if (s.kind === "enrol") { $("#tf-qr").src = s.qr; $("#tf-secret").textContent = s.secret; }
    if (factorId) { $("#tf-code").value = ""; $("#tf-code").focus(); }
  }
  function done() {
    up = false; factorId = null;
    $("#tf-qr").removeAttribute("src"); $("#tf-secret").textContent = ""; $("#tf-code").value = ""; $("#tf-msg").textContent = "";
    const f = finish; finish = null; f?.(true);
  }

  $("#f-two-factor").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!factorId) return;
    const btn = ev.target.querySelector("button");
    btn.disabled = true; $("#tf-msg").textContent = "";
    const r = await verify(factorId, $("#tf-code").value);
    btn.disabled = false;
    if (!r) done();
    else if (r.off) draw({ kind: "unavailable", message: r.message });
    else $("#tf-msg").textContent = r.message;
  });
  $("#f-tf-continue").addEventListener("submit", (ev) => { ev.preventDefault(); done(); });

  // Resolves once the person may go on: false if nothing was asked (a client, the demo, a session already at aal2), true after a
  // code was accepted or they carried on past the plain message. onAsk runs just before the screen appears.
  async function gate(isStaff, onAsk) {
    if (isStaff !== true || FP.demo?.active) return false;
    up = true;
    const s = await step();
    if (s.kind === "none") { up = false; return false; }
    onAsk?.();
    return new Promise((resolve) => { finish = resolve; draw(s); });
  }

  return { gate, step, verify, asking: () => up };
})();
