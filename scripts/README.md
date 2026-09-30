# Local integration harness

Seven flows that exercise the merged Final RC against a **real** local Supabase
stack over **real** HTTP, using session cookies the server itself issued.

No mocks, no fabricated JWTs, no fixture-flagged success. Each flow signs in
through GoTrue with `@supabase/ssr` against an in-process cookie store and
replays the exact cookies the server set as a `Cookie` header — the same thing
a browser carries.

| Script | Covers |
| --- | --- |
| `local-flow-1-employer-writes.mjs` | org creation, org PATCH, job create/edit/publish/close/delete |
| `local-flow-2-capacity.mjs` | plan capacity, credit consumption, idempotency |
| `local-flow-3-employer-authz.mjs` | the full role x org matrix, forged ids, anonymous |
| `local-flow-4-employer-reads-seats.mjs` | candidates, Fit Score, pipeline, analytics, team, notifications, seat checkout |
| `local-flow-5-candidate.mjs` | profile, localization, jobs, match, wallet, apply eligibility, tracked-job status, interviews, entitlement |
| `local-flow-6-resume.mjs` | storage bucket isolation and resume upload |
| `local-flow-7-guest-live.mjs` | share links, setup, session, activation, transcript, end, analysis, isolation |
| `probe-storage-api.mjs` | is the Storage API itself working, independent of the app |

Assertions are written against the **real** contracts — column names read from
`information_schema`, status vocabularies read from table `CHECK` constraints,
and allowed role sets read from the route's own predicate — rather than from
what the code appears to do. Most of the value has come from a flow failing
because the fixture guessed a field name wrong and the database saying so.

## Running them

The keys come from the environment; the harness never carries them. It exits
with instructions if they are absent.

```bash
npm run db:start                          # local stack, pinned CLI
node --env-file=.env.local scripts/local-flow-1-employer-writes.mjs
```

`.env.local` is gitignored and needs the values `npx supabase status` prints.
A credential in version control is a credential in version control even when it
is a local-stack value, and the remote's secret scanner is right to refuse one.

## Pin the Supabase CLI

`supabase` is a **pinned devDependency** and every entry point is an npm
script. This matters more than it looks.

The local stack is a set of container images, and the **storage-api binary**
and the **Postgres image that seeds `storage.objects`** have to come from the
same CLI release. Drift between them is invisible: not in the schema, not in
`db lint`, not in any project file. It surfaces only as a runtime failure deep
inside a provider, with an error naming an index the project never created.

Seen here on CLI 2.118.0, which had a `storage-api v1.73.1` container left over
from an earlier pull running against `postgres 17.6.1.171`:

```
42P10: there is no unique or exclusion constraint matching the ON CONFLICT specification
```

That older binary's upsert targeted `(name, bucket_id)`; the newer image's
baseline only carries partial and version-scoped indexes, which cannot serve as
an arbiter. Every resume upload failed. Restarting the stack reconciled
storage-api to v1.77.0 and uploads succeeded with **no schema change at all**.

So: one version, from `node_modules`, for every developer and for CI. Do not
`npx supabase@latest` — that reintroduces exactly this.

## What these are not

They are a developer tool. They are not part of the build, are never imported by
the application, and must not be wired into CI's pass/fail gate without first
deciding that a running local stack is a reasonable thing to require there.
