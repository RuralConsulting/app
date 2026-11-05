// Sign in, sign out, change password, and the first sign-in from an emailed link. Accounts are made by RCL
// (tools/add_person.py) or a farm's owner or admin (the People panel's invite function); sign-ups are off.
FP.auth = (() => {
  const sb = FP.sb;

  async function signIn(email, password) {
    const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
    if (!error) return null;
    if (/invalid login/i.test(error.message)) return "That email and password don't match. Check both and try again.";
    if (/rate|too many/i.test(error.message)) return "Too many attempts. Wait a few minutes and try again.";
    return error.message;
  }

  async function changePassword(current, next, again) {
    if (next.length < 10) return "The new password needs at least 10 characters.";
    if (next !== again) return "The two new passwords don't match.";
    if (next === current) return "The new password is the same as the current one.";
    // The project requires the current password to change it (Supabase: Secure password change)
    const { error } = await sb.auth.updateUser({ password: next, current_password: current });
    if (!error) return null;
    if (/current.*password|reauth/i.test(error.message)) return "Your current password isn't right.";
    if (/weak|pwned|leaked|known/i.test(error.message)) return "That password has appeared in a data breach somewhere. Choose a different one.";
    return error.message;
  }

  // An emailed invitation (or sign-in) link lands on the app as #access_token=…&refresh_token=…&type=invite, or
  // #error=…&error_description=… when it has expired. detectSessionInUrl is off (the hash is the app's router),
  // so the link is read here once and then cleared from the address bar.
  function fromLink(hash) {
    const p = new URLSearchParams(String(hash || "").replace(/^#/, ""));
    if (p.get("access_token") && p.get("refresh_token")) return { access_token: p.get("access_token"), refresh_token: p.get("refresh_token"), type: p.get("type") || "" };
    // Fixed wording only: never show text carried in the link itself.
    if (p.get("error") || p.get("error_code")) return { error: /expired|invalid/i.test(p.get("error_code") || "")
      ? "That link has expired or has already been used. Ask whoever added you to add you again, and a new link will be sent."
      : "That link didn't work. Ask whoever added you to add you again." };
    return null;
  }
  async function acceptLink(link) {
    const { error } = await sb.auth.setSession({ access_token: link.access_token, refresh_token: link.refresh_token });
    return error ? "That link didn't work. Ask whoever added you to add you again." : null;
  }
  // First password, straight after following an invitation link (a fresh sign-in, so no current password).
  async function setPassword(next, again) {
    if (next.length < 10) return "The password needs at least 10 characters.";
    if (next !== again) return "The two passwords don't match.";
    const { error } = await sb.auth.updateUser({ password: next });
    if (!error) return null;
    if (/weak|pwned|leaked|known/i.test(error.message)) return "That password has appeared in a data breach somewhere. Choose a different one.";
    if (/reauth|recent|current.*password|session.*missing|jwt.*expired/i.test(error.message)) return "This link is too old to set a password with. Ask whoever added you to add you again.";
    return error.message;
  }

  async function needsPassword() {
    const { data, error } = await sb.rpc("password_setup_required");
    if (error || typeof data !== "boolean") throw new Error("Could not check password setup. Reload to try again.");
    return data;
  }

  async function user() {
    const { data } = await sb.auth.getSession();
    return data.session?.user || null;
  }

  async function signOut() {
    await sb.auth.signOut();
  }

  return { signIn, signOut, changePassword, setPassword, fromLink, acceptLink, needsPassword, user };
})();
