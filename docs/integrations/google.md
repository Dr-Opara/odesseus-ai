# Google integration

Kernor uses Vercel Connect with a generic Google OAuth connector.

## Required OAuth scopes

Configure the connector with the narrow read-only scopes:

- `https://www.googleapis.com/auth/email.readonly`
- `https://www.googleapis.com/auth/calendar.events.readonly`

Phase 7 does not need Email send/modify or Calendar write access.

## Environment

```
ODYSSEUS_CONNECT_GOOGLE_CONNECTOR=
CRON_SECRET=
NEXT_PUBLIC_SITE_URL=
```

The Vercel deployment also needs Vercel OIDC enabled so `@vercel/connect` can exchange scoped credentials.

## Sync behavior

- Email: bounded recent search, max 25 candidate messages per sync
- Calendar: primary calendar, 7 days back through 90 days ahead
- Signals are deduplicated by Google external ID
- Ambiguous items do not change the application status
- Detected interviews create/update an interview record linked to the application
- Manual Sync is available from the Google integration page

## Scheduler

`vercel.json` requests a sync every 15 minutes.

That cadence requires a Vercel plan that supports sub-daily cron schedules. If the deployment plan does not support that cadence, keep manual sync enabled and configure an equivalent supported scheduler.
