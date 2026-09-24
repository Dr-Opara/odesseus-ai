# Localized Currency & Pricing Engine (Phase 2)

The pricing engine decides, **server-side**, which localized price a candidate
or employer sees. The frontend never converts currency or picks an amount —
it only displays what the engine returns.

## Architecture

Four additive `public` tables (migration `20260923000000_localized_pricing_engine.sql`):

| Table | Purpose |
| --- | --- |
| `pricing_products` | Canonical, machine-readable products (`product_key`). `display_name` is cosmetic. |
| `pricing_markets` | Reusable commercial markets bound to one currency + default formatting locale. |
| `pricing_prices` | Configurable prices in integer **minor units**, one per (product, market). |
| `pricing_country_markets` | Maps a country to its default pricing market. |

All four tables are publicly readable (RLS `SELECT` for `anon` + `authenticated`)
and read-only for clients — only the service role can mutate the catalog.

```
GET /api/pricing
GET /api/pricing/:productKey
```

resolve the authenticated user's market from their **profile country**
(`profiles.country_code`), look up the configured price, and return:

```json
{
  "market": { "market_key": "USD_US", "currency": "USD", "locale": "en-US", ... },
  "market_reason": "market_ok",
  "prices": [{
    "product_key": "candidate_live_single",
    "family": "candidate",
    "billing_type": "one_time",
    "available": true,
    "market_key": "USD_US",
    "currency": "USD",
    "amount_minor": 2499,
    "formatted_price": "$24.99",
    "is_fallback": false
  }]
}
```

`amount_minor` is the number the frontend must display unmodified;
`formatted_price` is a ready-to-render string produced with `Intl`.

## Money convention

- Every amount is an integer of the currency's **minor units**
  (`pricing_prices.amount_minor`, `integer NOT NULL CHECK > 0`).
- USD $24.99 → `2499`; GBP £24.99 → `2499`; JPY ¥2,500 → `2500` (JPY has
  **zero** decimal digits).
- No `float`/`numeric` money columns exist. Decimal digits and symbols are
  derived at display time via `Intl.NumberFormat` (see
  `src/lib/pricing/format.ts`), never hand-built with `"$"` concatenation.
- A composite FK pins each price's `currency` to its market's currency, so a
  price can never be displayed in the wrong currency.

## Market resolution order

1. **Authoritative billing country** — reserved for a later phase (there is no
   billing-country infrastructure yet).
2. **Account Country/Region** — `profiles.country_code` (Phase 2 source).
3. **Configured fallback** — `USD_US` reference market.

The country a candidate *wants to work in* and the country a recruiter visits
from **never** determine pricing. `preferred_currency` never changes the price;
a well-formed `profiles.locale` only changes display formatting.

## Fallback market

`FALLBACK_MARKET_KEY = "USD_US"` (`src/lib/pricing/config.ts`). Every
unresolvable case resolves deterministically to the USD reference prices:

| Case | `market_reason` |
| --- | --- |
| Country mapped to an active market | `market_ok` |
| Signed in, no `country_code` | `country_missing` |
| Country has no `pricing_country_markets` row | `country_unmapped` |
| Mapped market is inactive | `market_inactive` |
| Malformed country code | `malformed_country` |
| Anonymous visitor | `unauthenticated` |
| Even the fallback is inactive | `fallback_inactive` |

When an active market has **no price row** for a product, the service falls
back to the matching `USD_US` price and flags the row `is_fallback: true` so
the frontend can label it "reference pricing." Missing/inactive products return
`available: false` with a machine-readable `reason` — the engine never invents
an amount.

## Countries → markets

`pricing_country_markets` holds one default market per country. The seed is:

- **Data-driven**: every territory whose Phase 1 `default_currency = 'EUR'` is
  grouped into `EUR_EUROZONE` (no 241-row hand-maintained list).
- **Explicit**: `US→USD_US`, `GB→GBP_UK`, `CA→CAD_CA`, `NG→NGN_NG`,
  `GH→GHS_GH`, `KE→KES_KE`, `ZA→ZAR_ZA`, `AU→AUD_AU`, `JP→JPY_JP`.
- **Everything else**: no row → fallback `USD_US` reference pricing.

### Add a pricing market

1. Insert a `pricing_markets` row (market key, name, currency, locale, region, active).
2. Point countries at it with `pricing_country_markets` rows (one country can
   later be given its own market to override a group).
3. Add `pricing_prices` rows for each product — or leave prices absent to
   resolve through the fallback while the market is being set up.

All of this is a database/config change; no application code changes.

### Change a localized commercial price

`UPDATE pricing_prices SET amount_minor = ... WHERE product_key = ... AND market_key = ...;`
(plus `updated_at = now()`). The change is visible via the API immediately.

## Stripe mapping strategy

- `pricing_prices.stripe_price_id` / `stripe_product_id` are **optional,
  nullable** storage identifiers for wiring future Checkout sessions to
  configured prices.
- The database (not Stripe) is the source of truth for Odesseus commercial
  pricing. Stripe is only the payment-processor representation.
- The pricing API never returns these identifiers.
- Stripe itself still uses inline `price_data` today; wiring checkout to this
  engine is a later phase.

## Provisional pricing

- The active `USD_US` price rows are the **approved reference prices**
  (`metadata -> 'kind' = 'reference'`). After the current-contract migration
  (`20260924000000_current_pricing_contract.sql`) there are **15 active reference
  prices**: the three Live products (2499 / 5999 / 49900, unchanged byte-for-byte)
  plus the twelve new contract rows (49 / 199 / 1000 / 2000 / 5000 / 7900 / 14900 /
  29900 / 2900 / 4900 / 12900 / 2000 minor units).
- The six legacy `candidate_application_*` / `employer_starter_bundle` /
  `employer_addon_post` price rows are **deactivated** (`active = false`), not
  deleted; they keep their original amounts for historical display only.
- Every other launch market exists but carries **no price rows yet**. Their
  prices resolve through `USD_US` until real commercial prices are approved.
  Non-USD markets showing USD reference prices is the documented interim
  behavior, not approved localized pricing.

## Product matrix (current contract)

Active products (15):

| product_key | family | billing | USD_US amount | rule |
| --- | --- | --- | --- | --- |
| `candidate_standard_apply` | candidate | one_time rate | 49¢ | wallet debit on verified success |
| `candidate_smart_apply` | candidate | one_time rate | 199¢ | wallet debit on verified success |
| `wallet_topup_10` / `_20` / `_50` | candidate | one_time | 1000 / 2000 / 5000¢ | credits `wallet_balance_cents` |
| `candidate_live_single` | candidate | one_time | 2499¢ | pass never expires (unchanged) |
| `candidate_live_pack_3` | candidate | one_time | 5999¢ | 3 passes, never expire (unchanged) |
| `candidate_live_annual` | candidate | one_time | 49900¢ | 12 calendar months (unchanged) |
| `employer_starter` | employer | recurring 30d | 7900¢ | 3 job posts, no rollover |
| `employer_growth` | employer | recurring 30d | 14900¢ | 10 job posts, no rollover |
| `employer_business` | employer | recurring 30d | 29900¢ | 25 job posts, no rollover |
| `featured_7d` / `featured_14d` / `featured_30d_ai` | employer | one_time | 2900 / 4900 / 12900¢ | 7 / 14 / 30 days (AI flag on 30d) |
| `recruiter_seat_month` | employer | recurring 30d | 2000¢ | per additional team seat |

Deactivated in place (6, never deleted): `candidate_application_single`,
`candidate_application_pack_25/50/100`, `employer_starter_bundle`,
`employer_addon_post`.

## Product rule metadata

`pricing_products.metadata` (informational only; enforcement is a later phase):

- Apply rates: `charge_type = "apply_rate"`, `mode = "standard" | "smart"`,
  `credits_expire = false`.
- Wallet top-ups: `charge_type = "wallet_topup"`, `legacy_sku = "wallet_10|20|50"`.
- Employer plans: `charge_type = "employer_plan"`, `jobs = 3|10|25`,
  `rollover = false`, `billing_period_days = 30`.
- Featured listings: `charge_type = "featured"`, `featured_days = 7|14|30`,
  `ai = true` for `featured_30d_ai`.
- Recruiter seat: `charge_type = "recruiter_seat"`, `billing_period_days = 30`.
- Live single / pack of 3: passes never expire.
- Live annual: 12 calendar months from purchase.
- Legacy (deactivated, retained for history): application singles/packs
  `credits_expire = false`; old starter bundle / add-on.

## Why frontend FX conversion is prohibited

Conversion in the browser would let the displayed price drift from the
configured commercial price (rates, rounding, cache timing). Odesseus pricing
is deliberately commercial (a market is configured, not converted), so the
backend returns the exact `amount_minor` + currency to display. No FX API is
called anywhere; changing a price is a database update.

## Tests

- `tests/unit/pricing-format.test.ts` — Intl formatting incl. JPY zero-decimal.
- `tests/unit/pricing-service.test.ts` — resolution order, fallbacks, no floats.
- `tests/integration/pricing-api.test.ts` — API behavior, no Stripe leakage.
- `tests/integration/migration-pricing.test.ts` — legacy migration review.
- `tests/integration/migration-pricing-contract.test.ts` — current-contract
  migration review (additive, wallet, employer RLS, service-only RPCs).
- `supabase/tests/pricing.test.sql` — pgTAP schema/RLS/seed/wallet/trigger
  invariants (132 assertions, current contract).