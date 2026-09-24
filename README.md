# Odesseus

**Your next move, handled.**

Odesseus is a calm AI-assisted career workspace that helps a candidate move through:

**Find → Review → Apply → Track → Interview → Follow up**

## v0.1

The foundation now includes:

- Marketing landing page
- Supabase email/password authentication
- Protected logged-in routes
- Resume-first onboarding
- Private PDF/DOCX resume storage
- Candidate profile + job preference persistence
- Calm live-data dashboard
- Applications view
- Interview workspace
- Candidate profile editing
- Credit balance read model

## Supabase

The project uses Supabase for authentication, Postgres, RLS, and private resume storage.

Public user-data tables:

- `profiles`
- `job_preferences`
- `resumes`
- `job_opportunities`
- `applications`
- `interviews`
- `credit_balances`

Private server-only billing tables live in `odesseus_private`.

Every exposed user-data table has Row Level Security enabled. Candidate records are scoped to the authenticated user. Credit balances are intentionally read-only from the user-facing client so paid credits cannot be self-issued.

Resume files live in a private `resumes` bucket and are restricted to the owning user.

## Environment

Copy `.env.example` to `.env.local` and configure:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

Do not add Supabase secret/service-role keys to browser environment variables.

## Product principles

1. One screen, one obvious next action.
2. Show what needs attention, not everything Odesseus knows.
3. Keep AI behavior understandable and reviewable.
4. Never fabricate candidate qualifications.
5. Charge application credits only after confirmed successful submission.
6. Keep interview workspace free; consume an interview pass only when Odesseus Live starts.

## Pricing direction

Candidate core usage is pay-per-use from a prepaid wallet. No subscription for candidate core usage; employer plans and recruiter seats may be recurring subscriptions.

- $0.99 per successfully submitted application, across supported job boards and direct employer career sites (Workday, Indeed, UN Careers / UN job portals, Greenhouse, Lever, Ashby, iCIMS, direct company career websites, corporate ATS portals, and other supported job boards/employer application sites) — no platform-specific fee
- $24.99 per successfully activated Odesseus Live interview session
- No required subscription

## Next milestone

Odesseus Match:

1. Ingest the verified candidate profile and master resume.
2. Accept/discover job descriptions.
3. Generate an explainable match score.
4. Surface only strong matches.
5. Pass the selected job into resume tailoring.


## Odesseus Match v0.2

Odesseus Match adds the first real AI workflow.

### Flow

1. Candidate completes onboarding and uploads a master resume.
2. The first match request parses the resume into verified structured facts.
3. The parsed profile is cached in Supabase for reuse.
4. The user pastes a complete job description.
5. Odesseus compares the job only against verified candidate facts and preferences.
6. The final score is calculated deterministically from weighted dimensions.
7. Explicit critical missing requirements cap an otherwise high semantic score.
8. The match and explanation are saved to `job_opportunities`.

### Match weighting

- Required qualifications: 25%
- Professional experience: 20%
- Skills & tools: 20%
- Role & seniority: 10%
- Industry/domain: 10%
- Education & certifications: 5%
- Location/work arrangement: 5%
- Candidate preferences: 5%

The default candidate threshold remains **85%+**.

### AI privacy

Resume parsing and match assessment are performed server-side. The OpenAI API key is never exposed to the browser, and model requests are configured with storage disabled.

PDF resumes are passed as file input. DOCX resumes are converted to raw text server-side before structured extraction.


## Odesseus Resume v0.3

Resume Tailoring adds:

- job-targeted resume generation from verified facts
- auditable change records
- before/after diff review
- verified evidence for every material rewrite
- regenerate into a new version
- explicit user approval
- approved resume version frozen for the future application workflow

Odesseus never adds unsupported qualifications to improve a match.

## Codex development

The repository includes `AGENTS.md` with persistent product, security, AI, billing, and UX rules for Codex.

See `docs/development/codex.md` for the recommended VS Code + Codex workflow.


## Odesseus Billing v0.4

Billing adds prepaid application credits and interview passes without a subscription.

### Application credit

- 1 application credit — $0.99
- Covers a successful submission across any supported job board or employer career site (Workday, Indeed, UN Careers / UN job portals, Greenhouse, Lever, Ashby, iCIMS, direct company career websites, corporate ATS portals, and other supported job boards/employer application sites) — no platform-specific fee

Application credits are not consumed at purchase time. The Apply workflow consumes one credit only after a successful application submission.

### Interview pass

- 1 Odesseus Live interview pass — $24.99 (3 passes $59.99, annual $499)
- Workspace setup remains free
- The pass will be consumed only when the live interview assistant starts

### Fulfillment

Stripe Checkout creates one-time payment sessions. A signed Stripe webhook records an idempotent billing event, which atomically updates the user's wallet or pass balance.

The browser can read its own balances/history but cannot create or modify funds.

### Employer and promotion pricing

- Employer plans (recurring): Starter $79 / 3 jobs, Growth $149 / 10 jobs, Business $299 / 25 jobs
- Featured listings: $29 / 7 days, $49 / 14 days, AI Featured $129 / 30 days
- Recruiter seat: $20/month per additional employer-team seat


## Odesseus Apply v0.5

Odesseus Apply is an assisted, human-in-the-loop application browser.

### Flow

1. Candidate approves a tailored resume.
2. Odesseus generates a private PDF artifact for that exact approved version.
3. Candidate opens **Apply with Odesseus** and provides the employer application URL.
4. Odesseus starts a durable browser session.
5. Known fields are filled only from verified profile facts or reusable Q&A answers.
6. Odesseus pauses for:
   - login
   - MFA / verification codes
   - CAPTCHA / human verification
   - identity confirmation
   - sensitive demographic questions
   - unknown or unverified application questions
7. Candidate can open the live browser and take over when needed.
8. Odesseus pauses again before final submission.
9. Candidate explicitly presses **Submit application**.
10. The wallet is charged (Standard $0.49 / Smart $1.99) only after a success confirmation is detected.

### Coverage

Odesseus applies across supported job boards and direct employer career sites, including Workday, Indeed, UN Careers / UN job portals, Greenhouse, Lever, Ashby, iCIMS, direct company career websites, corporate ATS portals, and other supported job boards/employer application sites — at the same $0.99 price regardless of which platform the job is on. This is not a claim of universal technical compatibility with every site; coverage is scoped to supported job boards and employer career sites.

### Browser runtime

The current provider adapter uses Browserbase with Playwright and keeps the integration isolated under `src/lib/apply` so a different hosted browser provider can be substituted later.

Odesseus does not enable CAPTCHA solving or bypass MFA/identity controls.

### Durable execution

Apply runs use Vercel Workflow so browser work can pause and resume instead of relying on one long request.

### Data

Phase 5 adds:
- `application_answer_vault`
- `application_runs`
- `application_run_events`
- `application_run_questions`

User-facing run/event data is protected by RLS. System-created run records remain server controlled.


## Odesseus Track v0.6

Odesseus Track turns submitted applications into a persistent lifecycle.

### Lifecycle

Applied -> Employer response -> Assessment -> Interview -> Rejected / Withdrawn / Offer -> Accepted

### What is preserved

Each application freezes:
- the match score at application time
- the exact job context
- the exact approved resume used

The application timeline stores system, user, Email, and Calendar events in one history.

### User experience

- Search by company or role
- Filter by current status
- Open a single application record
- Review every status event
- Add a manual status update and note
- Open linked interview context when available


## Google Interview Detection v0.7

Phase 7 connects read-only Email and Google Calendar context to Odesseus Track.

### Detection

Odesseus can detect:
- recruiter / employer responses
- assessments and take-home requests
- interview invitations and scheduling updates
- offers
- rejections
- Google Calendar interview events

Signals are deduplicated and linked to an existing tracked application before Odesseus changes the pipeline.

When an interview is detected, Odesseus creates an interview record connected to:
- the application
- exact submitted resume
- job context
- meeting time when available
- meeting platform / link when available
- interviewer details when available

Ambiguous messages are not allowed to silently move an application.

### Access

Phase 7 requests only:
- Email read-only
- Google Calendar events read-only

See `docs/integrations/google.md` for Vercel Connect configuration.


## Provider-neutral Email + Calendar Detection

Phase 7 is provider-agnostic.

### Email providers

- Google / Gmail / Google Workspace
- Yahoo Mail
- iCloud Mail
- Custom IMAP-compatible mailboxes

### Calendar providers

- Google Calendar

Email and Calendar are separate connection types. A user can connect Yahoo for email and Google Calendar for interviews, or any other supported combination.

OAuth providers use Vercel Connect. iCloud/custom IMAP secrets are stored in Supabase Vault; normal application tables store only the Vault secret reference.

The normalized downstream signal type is always either `email` or `calendar`; provider identity is stored separately.


## Interview Workspace v0.8

The Interview Workspace is free and does not consume a Odesseus Live pass.

It combines:
- detected meeting date/time/platform/link
- interviewer details when available
- frozen application context
- exact submitted resume
- frozen job description
- application timeline
- interview type
- preferred response style
- preferred response length
- expected duration
- evidence-grounded readiness briefing

Readiness can generate:
- interview goal
- focus areas
- likely topic areas suggested by the role/stage
- verified experience examples
- questions to ask
- gaps to handle honestly

Odesseus does not run mock interviews in this phase.


## Multi-Round Interview Memory v0.9

Phase 9 carries interview context across rounds before Odesseus Live exists.

After a round, the candidate can record:
- questions asked
- topics discussed
- experiences/examples used
- interviewer comments/signals as the candidate observed them
- commitments and follow-ups
- additional notes

Odesseus creates a factual handoff that captures:
- what to build on
- what not to repeat unnecessarily
- open discussion threads
- focus areas for the next round

Later interview readiness automatically includes prior-round memory.

Phase 9 does not grade interview performance or predict hiring outcomes.

When Odesseus Live is introduced in Phase 10, transcript-derived memory can populate this same model automatically. Full post-interview analysis and follow-up remain Phase 11.


## Odesseus Live v0.10

Odesseus Live provides private, on-screen interview guidance while the candidate remains the speaker.

### Flow

1. Candidate opens the existing Interview Workspace.
2. Candidate explicitly starts Odesseus Live and consents to audio transcription.
3. Candidate selects:
   - shared interview audio
   - shared audio + microphone
   - microphone only
4. The browser creates an OpenAI Realtime WebRTC connection.
5. Audio is transcribed with `gpt-live-transcribe`.
6. Completed transcript turns are sent to Odesseus's server.
7. Odesseus determines whether the turn is an interview question.
8. If so, it generates grounded guidance using the frozen application, submitted resume, readiness brief, and prior rounds.
9. The candidate can request STAR, shorter, more technical, or follow-up guidance.
10. The candidate ends the session; transcript context remains attached to the interview.

### Billing

Opening the Live screen costs nothing.

One interview pass is consumed only after the realtime connection succeeds and the Live session atomically activates.

Reconnecting the same active session does not consume another pass.

### Boundaries

- Odesseus does not join the meeting as a participant.
- Odesseus does not speak for the candidate.
- Odesseus requires explicit audio consent.
- Shared video is immediately discarded; only the shared audio track is used.
- Guidance may use only verified candidate context.


## Post-Interview Analysis + Follow-Up v0.11

Phase 11 closes the interview loop after Odesseus Live.

### Analysis

After a completed Live session, Odesseus can generate:
- factual interview summary
- transcript limitations
- clearly supported questions asked
- topics discussed
- experiences referenced
- commitments / follow-ups
- answers that could be strengthened in a future round
- possible next-round preparation topics

Odesseus does not:
- score the interview
- predict whether the candidate will advance
- infer hidden interviewer intent
- treat mixed-audio transcript speaker attribution as certain

### Round memory

Transcript-backed facts are merged into the current interview round memory.

Existing user-entered notes/signals are preserved rather than overwritten.

The updated handoff becomes context for future interview readiness.

### Follow-up

Odesseus creates an editable follow-up draft from actual interview context.

The candidate must review/approve it before sending.

If an outbound Google connector is configured, Odesseus can send the approved draft through Gmail. Otherwise Odesseus opens the approved draft in the user's normal email app using a mailto handoff.

Read-only Email/Calendar connectors remain separate from optional outbound-send connectors.
