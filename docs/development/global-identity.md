# Global identity & localization (Phase 1)

How Odesseus stores and serves country, locale, language, currency, time zone,
and application contact data.

## Migration

`supabase/migrations/20260922000000_global_identity_localization.sql`

Purely additive:

1. Creates the canonical `public.countries` reference table and seeds it with
   250 ISO 3166-1 alpha-2 territories (246 active).
2. Adds six nullable columns to `public.profiles`.
3. Adds a partial index on `profiles.country_code`.

Nothing existing is dropped, renamed, retyped, or made `NOT NULL`. Existing
rows keep working with `NULL` localization fields.

## Schema

### `public.countries`

| Column | Type | Notes |
| --- | --- | --- |
| `code` | `text` PK | Must match `^[A-Z]{2}$` |
| `name` | `text` | Common English short name |
| `default_currency` | `text` | `^[A-Z]{3}$` |
| `default_locale` | `text` | BCP-47 style, `^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$` |
| `calling_code` | `text` nullable | IDD root plus suffix, for example `+1`; `NULL` for AQ and HM |
| `active` | `boolean` | `false` only for uninhabited territories (AQ, BV, HM, UM) |
| `created_at` / `updated_at` | `timestamptz` | `updated_at` is set by writers (repository convention: no triggers) |

Dataset provenance: generated once from the `mledoze/countries` JSON dataset
with curated overrides for calling codes (VA, SH, EH, AX, SJ), default
currencies (AQ, BV, HM, FM, ZW, CU, PS, EH, CK), and primary-language locales
(such as `en-IN`, `ur-PK`, `en-NG`, `de-AT`). Rows with unmapped languages fall
back to `en`.

### `public.profiles` (new columns, all nullable, all `NULL` by default)

| Column | Check |
| --- | --- |
| `country_code` | `^[A-Z]{2}$`, foreign key to `countries(code)` (`ON DELETE SET NULL`) |
| `locale` | `^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$` |
| `preferred_currency` | `^[A-Z]{3}$` |
| `timezone` | Up to 64 chars, `America/Chicago` style (`UTC` allowed) |
| `preferred_language` | `^[a-z]{2,3}$` |
| `application_contact_email` | At most 320 chars, basic `local@domain.tld` shape |

The legacy free-text `profiles.location` column is untouched. Old values are
never parsed or migrated into `country_code`.

## RLS and grants

- `countries`: RLS enabled, one policy `countries_select_public`
  (`FOR SELECT TO anon, authenticated USING (true)`). No client write policy
  exists, and `REVOKE ALL` removes the platform's default write grants, so
  only the service role can modify the dataset.
- `profiles`: no policy or grant changes in this migration. The existing
  owner-only policies (`profiles_*_own`, `auth.uid() = id`) and the anon
  revoke remain the privacy boundary for `application_contact_email`.

## API

### `GET /api/countries` (public)

Returns `{ countries: Country[] }` sorted by name, active rows only, with a
one-hour public cache. No session required.

### `GET` / `PATCH /api/profile/localization` (authenticated)

- `GET` returns the six fields for the signed-in user, falling back to
  explicit `null`s.
- `PATCH` validates the body with `localizationSchema`, then writes only
  whitelisted keys. Unknown keys (`id`, `full_name`, `onboarding_completed`,
  `skills`, ...) are stripped before the update. Blank strings normalize to
  `null` so forms can clear a field. Country and currency codes normalize to
  uppercase, language codes to lowercase.
- Runs through the cookie-scoped server client with an `id = userId` filter —
  never the service role.

Status codes: `401` without a session, `400` for invalid or empty payloads,
`500` on storage errors, `200` with the saved fields on success.

## Service and frontend

- `src/lib/countries/service.ts` — reusable `listCountries(client)` /
  `getCountry(client, code)` for any Supabase client; reads need no
  service-role key.
- `src/lib/countries/picker.ts` — frontend-only helpers. The pinned order
  (`US`, `GB`, `CA` first, then alphabetical by name) lives **only** here. The
  database stores no pin, priority, or region flag for these countries, and
  tests assert that.
- `src/lib/profile/localization.ts` — shared zod validation, the
  six-field whitelist, and `pickLocalizationFields()`.
- `src/components/localization-form.tsx` — the Settings card. Option lists
  (languages, locales, currencies, time zones) are derived from the dataset
  and `Intl`, so nothing needs hand maintenance.

## Privacy rules

`application_contact_email` exists only to fill job applications so recruiters
can reply.

- It is never read by anyone but the owner (row-level policies).
- It is stripped before any model call: `publicAccountProfile()` in
  `src/lib/ai/match.ts` removes it from the account-profile payload.
- No mail access, message reading, or provider sync exists anywhere in Phase
  1; tests assert this over every Phase 1 file.
- The apply flow still sources email from the auth account today; wiring the
  contact field into apply is intentionally deferred.

## Compatibility

Existing users are unaffected: all six columns are `NULL`, checks pass on
`NULL`, and no query, export, or policy changes behavior. Data export includes
the new fields automatically because it serializes the owner's own profile.

## Tests

| Suite | File |
| --- | --- |
| Validation unit tests | `tests/unit/localization-validation.test.ts` |
| Pinning and option helpers | `tests/unit/countries-picker.test.ts` |
| Country service | `tests/unit/countries-service.test.ts` |
| AI prompt privacy | `tests/unit/match-privacy.test.ts` |
| Country API (public read) | `tests/integration/countries-api.test.ts` |
| Profile localization API (auth, whitelist, ownership) | `tests/integration/profile-localization.test.ts` |
| Static migration/RLS review (13 tests, ~60 assertions) | `tests/integration/migration-global-identity.test.ts` |
| Live database/RLS (pgTAP, 35 assertions) | `supabase/tests/global_identity.test.sql` |

```bash
npm test                         # unit + integration + static SQL review
npx supabase start               # local stack (Docker required)
npx supabase db reset            # apply all migrations to a fresh database
npx supabase test db             # run the pgTAP suite
npm run lint
npm run build
```
