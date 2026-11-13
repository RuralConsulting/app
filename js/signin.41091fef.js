// SI1 (sign-in first): the sign-in form, with only the files it needs (boot.js SIGNIN). The form's submit is handled here,
// signed in or not. When the page was opened signed out (boot.js did not load the whole app at once), this file also decides what
// shows first: the sign-in form, or the privacy and terms note at #/privacy; a session the Auth client holds after all loads the
// app (main.js then starts it). After a sign-in the rest of the app is loaded (boot.js app()) and main.js takes over.
(() => {
  const { $, show } = FP;
  const msg = (text) => { $("#signin-msg").textContent = text || ""; };

  // Into the app: main.js starts it once loaded; if it is already here (a sign-in after the session ran out), start it again.
  async function enter() {
    if (FP.main) { FP.main.start(); return; }
    if (!FP.boot.loaded()) show("loading");
    try { await FP.boot.app(); }
    catch { show("screen-signin"); msg("The app couldn't load. Check your connection and reload the page."); }
  }

  $("#f-signin").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const btn = ev.target.querySelector("button");
    btn.disabled = true; msg("");
    const err = await FP.auth.signIn($("#email").value, $("#password").value);
    btn.disabled = false;
    if (err) { msg(err); return; }
    $("#password").value = "";
    enter();
  });

  if (FP.boot.eager) return;   // the whole app is loading: main.js decides what shows first

  // Signed out (until main.js is here): the privacy note opens from its link and leaving it goes back to sign in; the demo's
  // address loads the demo afresh.
  addEventListener("hashchange", () => {
    if (FP.main) return;
    if (FP.boot.isDemo(location.hash)) { location.reload(); return; }
    if (FP.privacy.isRoute(location.hash)) FP.privacy.open();
    else if (!$("#screen-privacy").hidden) { show("screen-signin"); $("#email").focus(); }
  });

  (async () => {
    const user = await FP.auth.user();
    FP.privacy.links();
    if (user) { enter(); return; }
    if (FP.privacy.isRoute(location.hash)) FP.privacy.open();
    else { show("screen-signin"); $("#email").focus(); }
    FP.boot.worker();   // once the page is up and quiet: never ahead of the form
  })();
})();
