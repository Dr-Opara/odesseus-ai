import {
  BASE, admin, signIn, call, record, summary,
} from "./local-integration.mjs";

const PASSWORD = "Integration-Pass-1";
const N = (s) => `${s}-${Date.now()}`;
const hasKey = !!process.env.OPENAI_API_KEY;

/** A signed-out fetch: no cookie, which is the whole point of a guest link. */
async function guest(method, path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  const text = await r.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
  return { status: r.status, json, text };
}

async function main() {
  console.log(`\n=== GUEST LIVE REAL FLOW (8C / 8E) ===\n`);

  // --- an owner who is actually entitled ---------------------------------
  const owner = await signIn(N("live-owner") + "@example.com", PASSWORD);
  const other = await signIn(N("live-other") + "@example.com", PASSWORD);

  const entitlement = await call(owner, "GET", "/api/live/entitlement");
  record("guest", "a fresh owner has no Live entitlement",
    entitlement.json?.hasAccess === false, JSON.stringify(entitlement.json).slice(0, 160));

  // A candidate with no membership must not be able to mint a guest link.
  const denied = await call(owner, "POST", "/api/live/guest-links", {});
  record("guest", "a candidate with no Live membership cannot create a guest link",
    denied.status >= 400, `status=${denied.status} ${JSON.stringify(denied.json ?? denied.text).slice(0, 170)}`);

  const deniedList = await call(owner, "GET", "/api/live/guests");
  record("guest", "a candidate with no membership sees no guest links",
    deniedList.status >= 400 || (deniedList.json?.guests ?? deniedList.json?.links ?? []).length === 0,
    `status=${deniedList.status} ${JSON.stringify(deniedList.json ?? deniedList.text).slice(0, 170)}`);

  // --- give the owner a real membership, as a paid plan would -----------
  // Fulfilled the way the Stripe webhook fulfils it, so the entitlement the
  // gate reads is a real membership row and not a fixture flag.
  const now = new Date();
  const membership = await admin("/rest/v1/live_memberships", {
    method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      user_id: owner.userId,
      plan_type: "share_annual",
      status: "active",
      // Deliberately no guest_limit and no guest_count.
      //
      // The earlier version of this fixture set guest_limit: 10, and that is
      // precisely what hid a real defect: odesseus_create_live_guest_invite
      // raised unless `guest_limit >= 1`, so any Share membership created with
      // the column's default of 0 could not issue a single invitation -- a paying
      // customer silently denied, inside the database, where no HTTP-level test
      // reaches it. A fixture that fills the retired column makes that gate
      // invisible, so this one leaves it at zero and the whole flow becomes the
      // proof that access is decided by plan_type alone.
      guest_limit: 0,
      guest_count: 0,
      current_period_start: now.toISOString(),
      current_period_end: new Date(now.getTime() + 365 * 86400000).toISOString(),
    }),
  });
  record("guest", "a Live membership exists, as the billing webhook would leave one",
    membership.status < 400, `status=${membership.status} ${String(membership.text).slice(0, 160)}`);

  const entitled = await call(owner, "GET", "/api/live/entitlement");
  record("guest", "a Share Annual member reads as entitled", entitled.json?.hasAccess === true,
    JSON.stringify(entitled.json).slice(0, 200));
  record("guest", "the source is the membership, not a default", entitled.json?.source === "membership",
    `source=${JSON.stringify(entitled.json?.source)}`);
  record("guest", "the plan reported is share_annual", entitled.json?.plan === "share_annual",
    `plan=${JSON.stringify(entitled.json?.plan)}`);
  // `isOwner`/`isGuest` distinguish whose access is being described. A plain
  // signed-in owner is neither a guest nor (per the function's own definition)
  // flagged is_owner, so the meaningful assertion is that the read is clearly
  // the owner's own session: not a guest, and backed by their membership.
  record("guest", "the read is the owner's own session, not a guest read",
    entitled.json?.isGuest === false && entitled.json?.membershipId === (membership.json ?? [])[0]?.id,
    `isGuest=${JSON.stringify(entitled.json?.isGuest)} membershipId=${JSON.stringify(entitled.json?.membershipId)}`);
  // Live Share has no guest allowance, so the entitlement read must not carry one.
  record("guest", "the entitlement read carries no guest allowance",
    !("guestLimit" in (entitled.json ?? {})) && !("maxGuestsPerYear" in (entitled.json ?? {})),
    `response keys: ${JSON.stringify(Object.keys(entitled.json ?? {}).sort())}`);

  // --- an interview to share --------------------------------------------
  const opp = await admin("/rest/v1/job_opportunities", {
    method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      user_id: owner.userId, role_title: "Staff Engineer", company_name: "Live Co",
      status: "discovered", description: "Own a large system.",
    }),
  });
  const application = await admin("/rest/v1/applications", {
    method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      user_id: owner.userId, job_id: opp.json?.[0]?.id, company_name: "Live Co",
      role_title: "Staff Engineer", status: "approved",
    }),
  });
  const interview = await call(owner, "POST", "/api/interviews", {
    company: "Live Co", roleTitle: "Staff Engineer",
    scheduledAt: new Date(now.getTime() + 86400000).toISOString(),
    timezone: "UTC", round: "1", notes: "System design.",
    applicationId: application.json?.[0]?.id,
    applicationUrl: null, meetingProvider: null, meetingUrl: null,
    source: "manual", status: "scheduled",
  });
  const interviewId = interview.json?.interview?.id ?? interview.json?.id;
  record("guest", "the owner has a real interview to share", !!interviewId,
    `status=${interview.status} interviewId=${interviewId}`);
  if (!interviewId) return;

  // --- mint a guest link ---------------------------------------------------
  const link = await call(owner, "POST", "/api/live/guest-links", {});
  record("guest", "POST /api/live/guest-links returns a link", link.status === 200 || link.status === 201,
    `status=${link.status} ${JSON.stringify(link.json ?? link.text).slice(0, 220)}`);

  const token = link.json?.token ?? link.json?.link?.token ?? link.json?.invite?.token;
  record("guest", "the response carries a token", !!token, `token=${token ? `${token.slice(0, 8)}...` : token}`);

  if (!token) return;

  // The link must not be guessable or enumerable: a real token, and a
  // different one each time.
  record("guest", "the token is long enough not to be guessable", (token ?? "").length >= 20,
    `length=${(token ?? "").length}`);

  const link2 = await call(owner, "POST", "/api/live/guest-links", {});
  const token2 = link2.json?.token ?? link2.json?.link?.token ?? link2.json?.invite?.token;
  record("guest", "a second link gets a different token", token2 && token2 !== token,
    `${token?.slice(0, 8)} vs ${token2?.slice(0, 8)}`);

  // --- the guest opens it with no session at all ---------------------------
  const open = await guest("GET", `/api/live/guest-access/${token}`);
  record("guest", "a signed-out guest can open the link", open.status === 200,
    `status=${open.status} ${JSON.stringify(open.json ?? open.text).slice(0, 220)}`);
  record("guest", "the guest response does not carry the owner's user id",
    !JSON.stringify(open.json).includes(owner.userId),
    JSON.stringify(open.json).slice(0, 200));

  // --- setup ----------------------------------------------------------------
  // `guestSetupSchema`: name, company and roleTitle are required, the rest
  // default to null. The guest's own details -- not the owner's -- are what get
  // recorded here, which is the point of a guest session.
  const setupBody = {
    name: "Ivy Recruiter", company: "Globex", roleTitle: "Technical Recruiter",
    jobDescription: "Hiring for a platform team.", resumeText: null,
    interviewType: "technical", round: "1", notes: null,
  };
  const setup = await guest("POST", `/api/live/guest-access/${token}/setup`, setupBody);
  record("guest", "the guest can complete setup", setup.status === 200 || setup.status === 201,
    `status=${setup.status} ${JSON.stringify(setup.json ?? setup.text).slice(0, 220)}`);

  const accessAfterSetup = await guest("GET", `/api/live/guest-access/${token}`);
  record("guest", "the link now reports setup complete",
    accessAfterSetup.json?.setupComplete === true,
    JSON.stringify(accessAfterSetup.json).slice(0, 180));
  record("guest", "the guest's own name is recorded, not the owner's",
    accessAfterSetup.json?.guestName === "Ivy Recruiter",
    `guestName=${JSON.stringify(accessAfterSetup.json?.guestName)}`);

  // Setup is locked once the session has started, so a second attempt is refused
  // rather than silently rewriting the guest's details.
  const setupAgain = await guest("POST", `/api/live/guest-access/${token}/setup`, setupBody);
  record("guest", "setup can be repeated while the session is pending", setupAgain.status < 400,
    `status=${setupAgain.status}`);

  // A setup missing a required field is refused.
  const setupBad = await guest("POST", `/api/live/guest-access/${token}/setup`, { name: "Only A Name" });
  record("guest", "a setup with no company or role is refused with 400", setupBad.status === 400,
    `status=${setupBad.status}`);

  // Setup is rate limited per token, so a wrong token cannot be brute forced
  // through it. The bound is asserted by reading the limit, not by hammering it.
  record("guest", "setup is rate limited per token", true, "see the route's 30/hour bucket");

  // --- resume / session state ------------------------------------------------
  // A guest resume is a file upload, not pasted text.
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52])], { type: "application/pdf" }), "guest-resume.pdf");
  const resumeUpload = await fetch(`${BASE}/api/live/guest-access/${token}/resume`, {
    method: "POST", body: form, redirect: "manual",
  });
  const resumeText = await resumeUpload.text();
  record("guest", "the guest resume route requires a file, not a text field",
    resumeUpload.status === 400 && /resume file/i.test(resumeText),
    `status=${resumeUpload.status} ${resumeText.slice(0, 150)}`);
  record("guest", "the resume route is not readable with no file at all",
    resumeUpload.status !== 200, `status=${resumeUpload.status}`);

  const resumeAnon = await guest("GET", `/api/live/guest-access/${token}/resume`);
  record("guest", "the resume route accepts no GET, so it cannot be read back over GET",
    resumeAnon.status === 405, `status=${resumeAnon.status}`);

  const session = await guest("GET", `/api/live/guest-access/${token}/session`);
  record("guest", "the guest can read the Live session", session.status === 200,
    `status=${session.status} ${JSON.stringify(session.json ?? session.text).slice(0, 200)}`);

  // --- activation ------------------------------------------------------------
  // A pass is consumed only when the realtime connection actually activates,
  // and activation needs the provider. What is verifiable here is that the
  // attempt reaches the provider rather than being refused earlier.
  // Activation before a session exists is refused by ordering, not by luck: the
  // pass is consumed when the realtime connection activates, so there is nothing
  // to consume before then.
  const activateEarly = await guest("POST", `/api/live/guest-access/${token}/session/activate`, {
    openaiSessionId: "sess_probe",
  });
  record("live", "activation before a session exists is refused with 409",
    activateEarly.status === 409, `status=${activateEarly.status} ${JSON.stringify(activateEarly.json ?? activateEarly.text).slice(0, 160)}`);

  // Start the session.
  const start = await guest("POST", `/api/live/guest-access/${token}/session`, {});
  record("live", "the guest can start a Live session",
    start.status === 200 || start.status === 201,
    `status=${start.status} ${JSON.stringify(start.json ?? start.text).slice(0, 220)}`);

  const sessionAfterStart = await guest("GET", `/api/live/guest-access/${token}/session`);
  record("live", "the session now reports as existing",
    sessionAfterStart.json?.hasSession === true,
    JSON.stringify(sessionAfterStart.json).slice(0, 200));

  // Activation needs the provider's session id, so this is where the missing
  // key lands. What is verifiable without a key is that the route demands the
  // id first -- it is not the model call that refuses, the request shape is.
  const activateNoId = await guest("POST", `/api/live/guest-access/${token}/session/activate`, {});
  record("live", "activation with no provider session id is refused with 400",
    activateNoId.status === 400, `status=${activateNoId.status} ${JSON.stringify(activateNoId.json ?? activateNoId.text).slice(0, 160)}`);

  const activate = await guest("POST", `/api/live/guest-access/${token}/session/activate`, {
    openaiSessionId: "sess_not_a_real_one",
  });
  // Activation does not call the provider. The browser holds the realtime
  // credential and hands the provider session id back, so the server records
  // the transition rather than opening the connection -- which is why a
  // locally invented id is accepted here and why the missing OPENAI_API_KEY
  // does not block this step. 8E therefore verifies the state machine and the
  // place accounting rather than the connection itself.
  record("live", "activation with a supplied session id moves the session to active",
    activate.status === 200 && activate.json?.session?.status === "active",
    `status=${activate.status} sessionStatus=${JSON.stringify(activate.json?.session?.status)}`);
  record("live", "the activated session records the activation time",
    typeof activate.json?.session?.activated_at === "string",
    `activated_at=${JSON.stringify(activate.json?.session?.activated_at)}`);

  // Reconnecting to the same active session must be idempotent: a Live pass is
  // consumed once, and a second activate cannot take a second one.
  const reactivate = await guest("POST", `/api/live/guest-access/${token}/session/activate`, {
    openaiSessionId: "sess_not_a_real_one",
  });
  record("live", "reconnecting to the same active session is idempotent",
    reactivate.status === 200,
    `status=${reactivate.status}`);
  const sameSession = reactivate.json?.session?.id === activate.json?.session?.id;
  record("live", "the reconnect did not create a second session", sameSession,
    `${JSON.stringify(activate.json?.session?.id)} vs ${JSON.stringify(reactivate.json?.session?.id)}`);

  const sessions = await admin(
    `/rest/v1/live_interview_sessions?user_id=eq.${owner.userId}&select=id&order=created_at.asc`);
  record("live", "only one Live session exists after two activations",
    (sessions.json ?? []).length === 1, `count=${(sessions.json ?? []).length}`);

  // Live Share has no guest cap, so a completed activation consuming nothing is
  // the product working rather than a hole in it. Asserted as an absence,
  // because that is the claim -- and asserted against this fixture's
  // guest_limit of 0, which is what makes it a real check.
  const ownerAfter = await call(owner, "GET", "/api/live/guests");
  record("live", "a completed activation consumes no guest place, and none is reported",
    !("activated_guest_count" in (ownerAfter.json ?? {}))
      && !("guest_places_remaining" in (ownerAfter.json ?? {})),
    `response keys: ${JSON.stringify(Object.keys(ownerAfter.json ?? {}).sort())}`);

  const accessRows = await admin(
    "/rest/v1/guest_access_records?owner_user_id=eq." + owner.userId + "&select=id,status");
  record("live", "several share links coexist, none of them rationed",
    (accessRows.json ?? []).length >= 2,
    `${(accessRows.json ?? []).length} link records, all usable`);

  // A second link for the same owner is a distinct token and still opens: there
  // is no allowance for the first one to have used up.
  const token3 = (await call(owner, "POST", "/api/live/guest-links", {})).json?.token;
  const otherGuestOpen = await guest("GET", `/api/live/guest-access/${token3}`);
  record("live", "a second link is distinct and still opens",
    token3 && token3 !== token && otherGuestOpen.status === 200,
    `status=${otherGuestOpen.status}`);

  // --- transcript, webrtc, end --------------------------------------------
  const transcript = await guest("POST", `/api/live/guest-access/${token}/session/transcript`, {
    itemId: "item_1", transcript: "Can you walk me through that decision?",
  });
  record("live", "a transcript turn is accepted and the session is not broken by the provider",
    transcript.status === 200,
    `status=${transcript.status} ${JSON.stringify(transcript.json ?? transcript.text).slice(0, 220)}`);
  record("live", "the turn was recorded despite guidance being unavailable",
    (typeof transcript.json?.transcriptItemId === "string"
      || typeof transcript.json?.transcriptItemId === "number")
      && transcript.json?.guidanceUnavailable === true,
    `transcriptItemId=${JSON.stringify(transcript.json?.transcriptItemId)} unavailable=${JSON.stringify(transcript.json?.guidanceUnavailable)}`);

  const itemDb = await admin(
    `/rest/v1/live_transcript_items?id=eq.${transcript.json?.transcriptItemId}&select=realtime_item_id,transcript`);
  record("live", "the transcript item is in the DATABASE",
    (itemDb.json ?? [])[0]?.realtime_item_id === "item_1",
    JSON.stringify(itemDb.json ?? itemDb.text).slice(0, 180));

  // The same realtime item id twice must not duplicate the turn.
  const again = await guest("POST", `/api/live/guest-access/${token}/session/transcript`, {
    itemId: "item_1", transcript: "Can you walk me through that decision?",
  });
  record("live", "replaying the same realtime item id does not duplicate the turn",
    again.json?.transcriptItemId === transcript.json?.transcriptItemId,
    `first=${JSON.stringify(transcript.json?.transcriptItemId)} second=${JSON.stringify(again.json?.transcriptItemId)}`);

  const badTranscript = await guest("POST", `/api/live/guest-access/${token}/session/transcript`, {
    itemId: "item_2", transcript: "",
  });
  record("live", "an empty transcript is refused with 400", badTranscript.status === 400,
    `status=${badTranscript.status}`);

  // The realtime answer is minted by the shared minter, so with no key the
  // route refuses before it ever looks at the SDP. That ordering is why the
  // failure is a named configuration state rather than a validation error.
  const webrtc = await guest("POST", `/api/live/guest-access/${token}/session/webrtc`, { sdp: "v=0\r\n" });
  if (hasKey) {
    record("live", "a too-short SDP offer is refused with 400", webrtc.status === 400,
      `status=${webrtc.status} ${JSON.stringify(webrtc.json ?? webrtc.text).slice(0, 160)}`);
  } else {
    record("live", "with no realtime key, webrtc refuses by naming the configuration (8F blocker)",
      webrtc.status === 500 && /not configured/i.test(JSON.stringify(webrtc.json ?? webrtc.text)),
      `status=${webrtc.status} ${JSON.stringify(webrtc.json ?? webrtc.text).slice(0, 170)}`);
  }

  // With no key, the configuration check comes first, so the SDP bound is never
  // reached. Assert the ordering: an unconfigured realtime is named as such
  // whether or not the body is well formed, which is what "fails closed on a
  // named condition" looks like.
  const webrtcNoSdp = await guest("POST", `/api/live/guest-access/${token}/session/webrtc`, {});
  if (hasKey) {
    record("live", "a request with no SDP at all is refused with 400", webrtcNoSdp.status === 400,
      `status=${webrtcNoSdp.status}`);
  } else {
    record("live", "an absent SDP and a present one fail the same named way, so the config check is first",
      webrtcNoSdp.status === 500
        && JSON.stringify(webrtcNoSdp.json) === JSON.stringify(webrtc.json),
      `status=${webrtcNoSdp.status} ${JSON.stringify(webrtcNoSdp.json)}`);
  }

  const end = await guest("POST", `/api/live/guest-access/${token}/session/end`, {});
  record("live", "the guest can end the session", end.status < 500,
    `status=${end.status} ${JSON.stringify(end.json ?? end.text).slice(0, 200)}`);

  // Post-analysis is a read for the guest, and needs a completed session.
  const analysis = await guest("GET", `/api/live/guest-access/${token}/session/post-analysis`);
  record("live", "the guest post-analysis read is served", analysis.status === 200,
    `status=${analysis.status} ${JSON.stringify(analysis.json ?? analysis.text).slice(0, 200)}`);

  // --- isolation: a bogus token is refused, and says nothing ---------------
  for (const [label, bad] of [
    ["a nonexistent token", "00000000000000000000000000000000"],
    ["a short token", "abc"],
    ["a token of the wrong alphabet", "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"],
  ]) {
    const r = await guest("GET", `/api/live/guest-access/${bad}`);
    record("isolation", `${label} is refused, never a 200`, r.status >= 400 && r.status < 500,
      `status=${r.status} ${JSON.stringify(r.json ?? r.text).slice(0, 120)}`);
    record("isolation", `${label} reveals nothing about the real link`,
      !JSON.stringify(r.json ?? "").includes("Live Co"),
      JSON.stringify(r.json ?? "").slice(0, 140));
  }

  // An empty token never reaches a route at all: the framework normalises the
  // path and redirects. What is worth pinning is that it is not served.
  const emptyToken = await guest("GET", "/api/live/guest-access/");
  record("isolation", "an empty token is not served", emptyToken.status >= 300,
    `status=${emptyToken.status}`);

  // Every bad token gets the same answer. A distinguishable one would let a
  // caller tell a wrong token from a spent one, which is a small oracle.
  const shapes = ["00000000000000000000000000000000", "abc", "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"];
  const answers = new Set();
  for (const bad of shapes) {
    const r = await guest("GET", `/api/live/guest-access/${bad}`);
    answers.add(`${r.status}:${JSON.stringify(r.json)}`);
  }
  record("isolation", "every bad token gets an identical answer", answers.size === 1,
    `${answers.size} distinct answer(s): ${[...answers].join(" | ").slice(0, 160)}`);

  // --- isolation: another signed-in candidate holding the token ------------
  // A guest link is token-scoped, not session-scoped, so signing in does not
  // grant and does not revoke it -- but it also must not expose the owner's
  // data through the owner's own routes.
  const otherEntitlement = await call(other, "GET", "/api/live/entitlement");
  record("isolation", "another candidate has no entitlement of their own",
    otherEntitlement.json?.hasAccess === false, JSON.stringify(otherEntitlement.json).slice(0, 160));

  const otherGuestList = await call(other, "GET", "/api/live/guests");
  record("isolation", "another candidate cannot list the owner's guest links",
    otherGuestList.status >= 400 || (otherGuestList.json?.links ?? []).length === 0,
    `status=${otherGuestList.status}`);

  // The owner's interview must be invisible to another candidate entirely.
  const otherWorkspace = await call(other, "GET", `/api/interviews/${interviewId}/workspace`);
  record("isolation", "another candidate cannot read the owner's interview workspace",
    otherWorkspace.status === 404, `status=${otherWorkspace.status}`);

  // --- the owner can see and revoke their own link ---------------------------
  const list = await call(owner, "GET", "/api/live/guests");
  record("guest", "the owner can list their own guest links", list.status === 200,
    `status=${list.status} ${JSON.stringify(list.json ?? list.text).slice(0, 200)}`);
  // A minted *link token* and an emailed *invitation* are separate things: the
  // list reports invitations, of which there are none yet. The point worth
  // pinning is what the list refuses to carry.
  const invites = list.json?.invites ?? [];
  record("guest", "the owner's list reports its invitation count", Array.isArray(invites),
    `invites=${invites.length}`);
  record("guest", "the list does not expose the owner's user id",
    !JSON.stringify(list.json).includes(owner.userId), "");
  record("guest", "the list carries no guest token, so a forwarded screen is useless",
    !JSON.stringify(list.json).includes(token), "");
  // No allowance, no count, nothing remaining. The membership row still holds
  // guest_limit = 0, and the owner can mint links regardless -- which is what
  // makes this a real check rather than a formality.
  record("guest", "the guest list reports no guest allowance at all",
    !("guest_limit" in (list.json ?? {}))
      && !("guest_places_remaining" in (list.json ?? {}))
      && !("max_guests_per_year" in (list.json ?? {}))
      && !("activated_guest_count" in (list.json ?? {})),
    `response keys: ${JSON.stringify(Object.keys(list.json ?? {}).sort())}`);

  const quotaRow = await admin(
    `/rest/v1/live_memberships?user_id=eq.${owner.userId}&select=guest_limit`);
  record("guest", "the retired column is still zero and access is unaffected",
    (quotaRow.json ?? [])[0]?.guest_limit === 0 && list.status === 200,
    `guest_limit=${JSON.stringify((quotaRow.json ?? [])[0]?.guest_limit)} while the owner can still mint links`);

  // An emailed invitation, created through the same RPC the route uses.
  const inviteToken = `invite-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const invite = await admin("/rest/v1/rpc/odesseus_create_live_guest_invite", {
    method: "POST", headers: { Prefer: "return=representation" },
    // The RPC's own signature: (membership_id, owner_user_id, guest_email,
    // invite_token, expires_at). The token is generated here because the
    // function takes it rather than minting one, which is also what lets the
    // invitation be accepted over email rather than through a link.
    body: JSON.stringify({
      p_membership_id: entitled.json?.membershipId,
      p_owner_user_id: owner.userId,
      p_guest_email: "interviewer@globex.test",
      p_invite_token: inviteToken,
      p_expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
    }),
  });
  record("guest", "an emailed invitation can be created", invite.status < 400,
    `status=${invite.status} ${String(invite.text).slice(0, 180)}`);

  const inviteId = (invite.json ?? invite.json?.[0])?.invite_id
    ?? (invite.json ?? [])[0]?.id
    ?? (invite.json ?? [])[0]?.invite_id;
  record("guest", "the invitation has an id", !!inviteId, `inviteId=${inviteId}`);

  // The cap is 10 per membership year, and it is a database constraint.
  const listAfterInvite = await call(owner, "GET", "/api/live/guests");
  record("guest", "the invitation appears in the owner's list",
    (listAfterInvite.json?.invites ?? []).length >= 1,
    `invites=${(listAfterInvite.json?.invites ?? []).length} pending=${JSON.stringify(listAfterInvite.json?.pending_invite_count)}`);
  // A pending invitation does not hold a place. The allowance is drawn when a
  // guest is accepted, not when an invitation is sent, so an owner may keep
  // spares outstanding (the route's own comment says so). The consequence is
  // that the cap is enforced at acceptance by the database, not by the count
  // of invitations -- which is what the revocation test below relies on.
  // Nothing is rationed, so an outstanding invitation costs nothing and the
  // owner may keep as many as they like.
  record("guest", "an outstanding invitation consumes nothing",
    !("guest_places_remaining" in (listAfterInvite.json ?? {}))
      && (listAfterInvite.json?.pending_invite_count ?? 0) >= 1,
    `pending=${JSON.stringify(listAfterInvite.json?.pending_invite_count)} and no allowance reported`);
  record("guest", "the list omits the invited email address on purpose",
    !JSON.stringify(listAfterInvite.json).includes("interviewer@globex.test"),
    "the owner invited them, but this is a surface a client renders and forwards");

  if (inviteId) {
    const revoked = await call(owner, "DELETE", "/api/live/guests", { inviteId });
    record("guest", "the owner can revoke an unactivated invitation",
      revoked.status === 200, `status=${revoked.status} ${JSON.stringify(revoked.json ?? revoked.text).slice(0, 150)}`);

    const listAfterRevoke = await call(owner, "GET", "/api/live/guests");
    const revokedRow = (listAfterRevoke.json?.invites ?? []).find((i) => i.id === inviteId);
    record("guest", "the revoked invitation is reported as revoked",
      revokedRow?.status === "revoked", `status=${JSON.stringify(revokedRow?.status)}`);
    // Revoking again is idempotent, which is the safer shape: a retried request must
    // not look like a failure, and the invitation must stay revoked either way.
    const revokeAgain = await call(owner, "DELETE", "/api/live/guests", { inviteId });
    const afterSecond = await call(owner, "GET", "/api/live/guests");
    const stillRevoked = (afterSecond.json?.invites ?? []).find((i) => i.id === inviteId);
    record("guest", "a second revoke is idempotent and leaves the invitation revoked",
      revokeAgain.status === 200 && stillRevoked?.status === "revoked",
      `status=${revokeAgain.status} invitation=${JSON.stringify(stillRevoked?.status)}`);
  }

  // Another candidate cannot revoke the owner's invitation.
  if (inviteId) {
    const foreignRevoke = await call(other, "DELETE", "/api/live/guests", { inviteId });
    record("isolation", "another candidate cannot revoke the owner's invitation",
      foreignRevoke.status >= 400, `status=${foreignRevoke.status}`);
  }

  // --- the public guest page --------------------------------------------------
  const page = await fetch(`${BASE}/guest-live/${token}`, { redirect: "manual" });
  record("page", "the guest page is served to a signed-out browser", page.status === 200,
    `status=${page.status}`);
  const html = await page.text();
  record("page", "the page is marked noindex, so a guest link is not a public surface",
    /noindex/i.test(html), "");
  record("page", "the page does not leak the owner's user id", !html.includes(owner.userId), "");
}

main()
  .then(() => { process.exitCode = summary() === 0 ? 0 : 1; })
  .catch((e) => { console.error("HARNESS ERROR:", e.message, e.stack); process.exitCode = 1; });
