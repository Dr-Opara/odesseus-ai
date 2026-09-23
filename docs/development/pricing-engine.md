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

- The nine `USD_US` price rows are the **approved reference prices**
  (`metadata -> 'kind' = 'reference'`).
- Every other launch market exists but carries **no price rows yet**. Their
  prices resolve through `USD_US` until real commercial prices are approved.
  Non-USD markets showing USD reference prices is the documented interim
  behavior, not approved localized pricing.

## Product rule metadata

`pricing_products.metadata` (informational only; enforcement is a later phase):

- Application singles/packs: `credits_expire = false` (no expiry).
- Live single / pack of 3: passes never expire.
- Live annual: 12 calendar months from purchase.
- Employer starter: recurring every 30 days, 5 base job-post credits expiring
  at cycle end, no rollover.
- Employer add-on: one job-post credit, expires 30 days after purchase.

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
- `tests/integration/migration-pricing.test.ts` — additive/RLS/reference-price review.
- `supabase/tests/pricing.test.sql` — pgTAP schema/RLS/seed invariants (65 assertions).