// Sign in, sign out and change password. Accounts are made by RCL (tools/add_person.py); sign-ups are off.
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

  async function user() {
    const { data } = await sb.auth.getSession();
    return data.session?.user || null;
  }

  async function signOut() {
    await sb.auth.signOut();
  }

  return { signIn, signOut, changePassword, user };
})();
