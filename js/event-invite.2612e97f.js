// EV3: "Email the invitation" on an event (for those who add people there: the group's editors, facilitators, advisors and admins).
// A sheet with the invitation, editable and not saved anywhere; "Open in my email" (a mailto: link: the person's own email program
// opens with the addresses in BCC, the subject and the text; the app sends nothing and records nothing as sent); "Copy addresses" and
// "Copy invitation text"; and the names of anyone it covers who has no email address on record, to ring instead.
// Addresses only for the group's facilitators, advisors and admins, read with the read People's "Copy email addresses" already uses
// (public.crm_email_list, theirs alone); an editor gets the text and an empty email to address themselves. Nothing here goes into the
// page's address or history, or to any log. Words and logic: event-invite-model.js.
(function (root) {
  const FP = root.FP;
  const I = () => FP.eventInviteModel, E = () => FP.eventsModel;
  const el = (...a) => FP.el(...a);

  // ctx: { sb, group: {id, name, role}, ev, attendees, register, now }
  function open(opener, ctx) {
    const sb = ctx.sb || FP.sb, ev = ctx.ev, addressesToo = I().readsAddresses(ctx.group.role);
    const inv = I().invitation(ev, { group: ctx.group.name, when: E().whenText(ev) });
    const st = { subject: inv.subject, body: inv.body, field: "bcc", list: [], missing: [], who: null, people: 0, counts: { list: 0, members: 0 }, choice: null,
      reading: addressesToo, failed: null, said: null };
    let box = null;
    FP.sheet.open({ opener, title: "Email the invitation", where: ev.title, className: "ei-sheet", body: () => (box = el("div", { class: "ei" }, ...parts())) });
    const redraw = () => { if (box?.isConnected) { const keep = document.activeElement?.id; box.replaceChildren(...parts()); if (keep) box.querySelector("#" + keep)?.focus(); } };

    if (addressesToo) read().then(redraw);
    // (review of #610: nobody by default once people on the list have replied; a choice made on purpose; never a read with no ids)
    async function read() {
      const c = I().covers(ctx.attendees, ctx.register, st.choice);
      Object.assign(st, { who: c.who, people: c.people.length, counts: c.counts, list: [], missing: [], failed: null });
      try {
        const rows = [];
        for (const args of I().emailListCalls(ctx.group.id, c.people)) {
          const { data, error } = await sb.rpc("crm_email_list", args);
          if (error) throw error;
          rows.push(...(Array.isArray(data) ? data : []));
        }
        Object.assign(st, I().addresses(c.people, rows));
      } catch (e) { st.failed = e?.message || String(e); }
      st.reading = false;
    }

    async function copy(text, what) {
      try { await root.navigator.clipboard.writeText(text); st.said = what + " copied."; }
      catch { st.said = "Couldn't copy here: select the " + what.toLowerCase() + " and copy it yourself."; }
      redraw();
    }

    function parts() {
      const subject = el("input", { id: "ei-subject", type: "text", value: st.subject, autocomplete: "off", "aria-describedby": "ei-not-saved" });
      const body = el("textarea", { id: "ei-body", rows: "9" }, st.body);
      // the text as edited goes into the links at once; nothing is saved
      const relink = () => { st.subject = subject.value; st.body = body.value; box?.querySelector(".ei-open")?.replaceWith(openPart()); };
      subject.addEventListener("input", relink); body.addEventListener("input", relink);
      return [
        st.said ? el("p", { class: "ei-said", role: "status" }, st.said) : el("p", { class: "ei-said", role: "status", hidden: true }),
        whoPart(),
        el("label", { for: "ei-subject" }, "Subject"), subject,
        el("label", { for: "ei-body" }, "Invitation"), body,
        el("small", { id: "ei-not-saved", class: "ei-fine" }, "Change the words here if you like: they go into the email, and are not saved."),
        openPart(),
        el("div", { class: "ei-copy" },
          addressesToo && st.list.length ? el("button", { type: "button", class: "secondary", "data-action": "ei-copy-addresses", onclick: () => copy(I().copyText(st.list), "Addresses") }, "Copy addresses") : null,
          el("button", { type: "button", class: "secondary", "data-action": "ei-copy-text", onclick: () => copy(st.subject + "\n\n" + st.body, "Invitation text") }, "Copy invitation text")),
        el("p", { class: "ei-fine" }, "Nothing is sent from here and nothing is recorded as sent. Mark people Invited on the event yourself."),
      ];
    }

    function whoPart() {
      if (!addressesToo) return el("p", { class: "ei-who" }, "Email addresses are kept for the group's coordinators: add the people in your own email.");
      if (st.reading) return el("p", { class: "ei-who", role: "status" }, "Reading the email addresses…");
      if (st.failed) return el("p", { class: "ei-who", role: "alert" }, "Couldn't read the email addresses just now: " + st.failed);
      const n = st.list.length;
      // people listed, none marked Invited: no addresses until the coordinator chooses who, on purpose, each choice with its count
      const choose = st.who === "none" || st.who === "list" || (st.who === "members" && st.choice === "members") ? el("fieldset", { class: "ei-field ei-choose" }, el("legend", {}, "Who to email"),
        ...[["list", "Everyone on the list, whatever their reply (" + I().plural(st.counts.list, "person", "people") + ")"], ["members", "All current members (" + st.counts.members + ")"]].map(([v, words]) =>
          el("label", { class: "ei-radio" }, el("input", { type: "radio", name: "ei-choose", value: v, ...(st.choice === v ? { checked: true } : {}),
            onchange: () => { st.choice = v; st.reading = true; redraw(); read().then(redraw); } }), words))) : null;
      if (st.who === "none") return el("div", { class: "ei-who" },
        el("p", { class: "ei-none" }, "No one is marked Invited. Everyone on the list has replied or came, so no addresses are added. If you mean to email people again, choose who:"), choose);
      const whom = st.who === "invited" ? I().plural(st.people, "person marked Invited", "people marked Invited")
        : st.who === "list" ? "Everyone on the list, whatever their reply (" + I().plural(st.people, "person", "people") + ")"
        : st.choice === "members" ? "All current members (" + st.people + ")"
        : "No one is on the list yet, so this covers all " + I().plural(st.people, "current member", "current members");
      return el("div", { class: "ei-who" }, choose,
        el("p", {}, whom + ": " + I().plural(n, "email address", "email addresses") + "."),
        st.missing.length ? el("p", { class: "ei-missing" }, (st.missing.length === 1 ? "1 person has" : st.missing.length + " people have") + " no email address on record: " + I().names(st.missing) + ". Ring them, or add their address in People.") : null,
        n ? el("details", { class: "ei-list" }, el("summary", {}, "Show the addresses"), el("p", {}, I().copyText(st.list))) : null,
        n ? el("fieldset", { class: "ei-field" }, el("legend", {}, "Put the addresses in"),
          ...[["bcc", "BCC (recommended: people don't see each other's addresses)"], ["to", "To"]].map(([v, words]) => el("label", { class: "ei-radio" },
            el("input", { type: "radio", name: "ei-field", value: v, ...(st.field === v ? { checked: true } : {}), onchange: () => { st.field = v; box?.querySelector(".ei-open")?.replaceWith(openPart()); } }), words))) : null);
    }

    function openPart() {
      const list = addressesToo ? st.list : [];
      if (addressesToo && (st.reading || st.failed)) return el("div", { class: "ei-open" });
      const r = I().links({ list, subject: st.subject, body: st.body, field: st.field });
      const a = (l, words) => el("a", { class: "button primary ei-mail", href: l.href, "data-action": "ei-open", rel: "noopener" }, words);
      if (!r.links.length) return el("div", { class: "ei-open" }, el("p", { class: "ei-long", role: "status" }, "This is too long for an email link: use Copy addresses and Copy invitation text instead."));
      const out = [];
      if (r.links.length === 1) out.push(a(r.links[0], "Open in my email"));
      else {
        out.push(el("p", { class: "ei-long", role: "status" }, I().plural(list.length, "address", "addresses") + " are too many for one email link (some email programs cut a link of more than about "
          + r.max.toLocaleString("en-NZ") + " characters). Open them in " + r.links.length + " emails, or use Copy addresses."));
        out.push(el("div", { class: "ei-batches" }, ...r.links.map((l, i) => a(l, "Open email " + (i + 1) + " of " + r.links.length + " (" + I().plural(l.count, "person", "people") + ")"))));
      }
      if (r.textLeftOut) out.push(el("p", { class: "ei-long" }, "The invitation is too long to go in the link as well: paste it in with Copy invitation text."));
      out.push(el("small", { class: "ei-fine" }, "Opens your own email program (Outlook, Mail, or Gmail if it is set to open email links)."));
      return el("div", { class: "ei-open" }, ...out);
    }
  }

  FP.eventInvite = { open };
})(window);
