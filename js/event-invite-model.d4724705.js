// EV3: invite people to an event from the coordinator's own email (the owner, 18 Nov 2026: the app sends nothing; "copy of invite
// text into an email and an email list that can be copied into an email? Or opens it all in their preferred outlook"). The pure
// parts: the invitation (subject and text) made from the event; who it covers and their addresses; the mailto: link or links (BCC
// unless asked otherwise), split into numbered batches when one link would be too long; the separators. No DOM, no reads.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else { root.FP = root.FP || {}; root.FP.eventInviteModel = api; }
})(typeof window === "undefined" ? globalThis : window, function () {
  // Who reads members' email addresses: the group's facilitators, advisors and admins (public.crm_email_list is theirs alone, as
  // People's "Copy email addresses" is). An editor records attendance but never reads contact details.
  const ADDRESS_ROLES = ["facilitator", "advisor", "admin"];
  const readsAddresses = (role) => ADDRESS_ROLES.includes(role);

  // Copied addresses are separated by "; ": Outlook (desktop, web and new) always splits on a semicolon, and so do Gmail and Apple Mail
  // when a list is pasted; a comma is split by Outlook desktop only when its comma setting is on. Inside a mailto: link the standard
  // (RFC 6068) separator is a comma, which every mail program that opens such links reads.
  const COPY_SEP = "; ";
  const LINK_SEP = ",";
  // A mailto: link longer than this is cut short or refused by some mail programs and browsers (Outlook on Windows among them): the
  // whole link, encoded, stays within it.
  const LINK_MAX = 2000;

  // The invitation, in plain words, from the event: what, when, where, what it is about, who it is from. Never the coordinators'
  // notes (they are theirs alone, NP1). { subject, body }
  function invitation(ev, { group = "", when = "" } = {}) {
    const title = String(ev?.title || "").trim();
    const topics = Array.isArray(ev?.topics) ? ev.topics.map((t) => String(t).trim()).filter(Boolean) : [];
    const body = [
      "Hello,",
      "",
      "You're invited to " + title + ".",
      "",
      "When: " + when,
      ev?.place_name ? "Where: " + ev.place_name : null,
      topics.length ? "About: " + topics.join(", ") : null,
      "",
      "Please reply to let us know if you can come.",
      "",
      group ? "From " + group : null,
    ].filter((l) => l != null).join("\n").replace(/\n{3,}/g, "\n\n").trim();
    return { subject: "Invitation: " + title + (when ? " (" + when.replace(/,.*$/, "") + ")" : ""), body };
  }

  // Who the email covers (review of #610: never everyone by default once anyone has replied).
  //   * people marked Invited: those, and only those;
  //   * an empty list: every current member on the register (said so: the usual first invitation);
  //   * people listed but none marked Invited (they have replied, or came): nobody, until the coordinator chooses on purpose
  //     ("list": everyone on the list, whatever their reply; "members": all current members), each choice with its count.
  // attendees: the event's list; register: the current members ({ id, business_name }); choice: null | "list" | "members".
  // -> { who: "invited" | "members" | "list" | "none", people: [{ name, group_member_id|null }], choose: bool, counts: { list, members } }
  function covers(attendees, register, choice = null) {
    const list = attendees || [], reg = register || [];
    const person = (a) => ({ name: a.name, group_member_id: a.group_member_id || null });
    const members = () => reg.map((b) => ({ name: b.business_name, group_member_id: b.id }));
    const counts = { list: list.length, members: reg.length };
    const invited = list.filter((a) => a.status === "invited");
    if (invited.length) return { who: "invited", people: invited.map(person), choose: false, counts };
    if (!list.length) return { who: "members", people: members(), choose: false, counts };
    if (choice === "list") return { who: "list", people: list.map(person), choose: true, counts };
    if (choice === "members") return { who: "members", people: members(), choose: true, counts };
    return { who: "none", people: [], choose: true, counts };
  }

  // The reads of crm_email_list for these people: their member ids, at most 500 a call. NEVER a call with no ids: the function answers
  // an empty id list with every member of the group (review of #610), so no ids means no read at all.
  function emailListCalls(g, people, size = 500) {
    const ids = [...new Set((people || []).map((p) => p.group_member_id).filter(Boolean))];
    const out = [];
    for (let i = 0; i < ids.length; i += size) out.push({ g, filter: { ids: ids.slice(i, i + size) } });
    return out;
  }

  // Each person's addresses from crm_email_list's rows (the member's primary contact's emails, else the member's own), one of each
  // address. Anyone with none (a sign-in or a typed name on the list, or a member with no address on record) is named in missing.
  function addresses(people, rows) {
    const by = new Map((rows || []).map((r) => [r.group_member_id, r]));
    const seen = new Set(), list = [], missing = [];
    for (const p of people || []) {
      const r = p.group_member_id ? by.get(p.group_member_id) : null;
      const mine = r ? ((r.emails || []).length ? r.emails : r.business_emails || []) : [];
      if (!mine.length) { missing.push(p.name); continue; }
      for (const e of mine) { const k = String(e).trim().toLowerCase(); if (k && !seen.has(k)) { seen.add(k); list.push(String(e).trim()); } }
    }
    return { list, missing };
  }

  const copyText = (list) => (list || []).join(COPY_SEP);

  // One mailto: link. field: "bcc" (people do not see each other's addresses) or "to".
  function link({ list = [], subject = "", body = "", field = "bcc" } = {}) {
    const who = list.map((a) => encodeURIComponent(a).replace(/%40/g, "@")).join(LINK_SEP);
    const q = [];
    if (field === "bcc" && who) q.push("bcc=" + who);
    if (subject) q.push("subject=" + encodeURIComponent(subject));
    if (body) q.push("body=" + encodeURIComponent(String(body).replace(/\r?\n/g, "\r\n")));
    return "mailto:" + (field === "to" ? who : "") + (q.length ? "?" + q.join("&") : "");
  }

  // The links to open, each within LINK_MAX. One when it fits; otherwise numbered batches, every address in exactly one, never cut.
  // When the text itself leaves too little room, the links carry the subject only and textLeftOut says so (copy the text instead).
  // -> { links: [{ href, count }], textLeftOut, max }
  function links({ list = [], subject = "", body = "", field = "bcc", max = LINK_MAX } = {}) {
    const pack = (withBody) => {
      const base = { subject, body: withBody ? body : "", field };
      if (!list.length) { const href = link({ ...base, list: [] }); return href.length <= max ? [{ href, count: 0 }] : null; }
      const out = [];
      let cur = [];
      for (const a of list) {
        const next = [...cur, a];
        if (link({ ...base, list: next }).length <= max) { cur = next; continue; }
        if (!cur.length) return null;    // one address with this text is already too long
        out.push(cur); cur = [a];
        if (link({ ...base, list: cur }).length > max) return null;
      }
      if (cur.length) out.push(cur);
      return out.map((part) => ({ href: link({ ...base, list: part }), count: part.length }));
    };
    const full = pack(true);
    if (full) return { links: full, textLeftOut: false, max };
    // (a long text: one link per batch would be few addresses; the text goes by Copy instead)
    return { links: pack(false) || [], textLeftOut: true, max };
  }

  // "Aroha, Ben and Cara"
  const names = (list) => (list.length < 2 ? list.join("") : list.slice(0, -1).join(", ") + " and " + list[list.length - 1]);
  const plural = (n, one, many) => n + " " + (n === 1 ? one : many);

  return { ADDRESS_ROLES, readsAddresses, COPY_SEP, LINK_SEP, LINK_MAX, invitation, covers, emailListCalls, addresses, copyText, link, links, names, plural };
});
