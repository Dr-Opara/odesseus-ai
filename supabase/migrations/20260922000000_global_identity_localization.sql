-- Global identity & localization foundation (Phase 1).
--
-- This migration is additive and safe for existing users:
--   1. Creates the canonical `countries` reference table (ISO 3166-1 alpha-2)
--      and seeds a global dataset (250 territories, 241 active).
--   2. Adds six nullable localization columns to `profiles`.
--
-- The country seed block below is GENERATED from
-- scripts/countries/data.ts (npm run countries:generate). Do not hand-edit it;
-- the regression suite byte-compares it against generator output.
--
-- Launch-market policy (see docs/development/global-identity.md):
--   * AX, BL, CW, RE, ST stay in the canonical dataset (valid ISO records)
--     but ship with active = false for V1.
--   * TR (Türkiye) is active from day one.
--
-- Deliberate non-changes:
--   * No existing column is renamed, dropped, retyped, or made NOT NULL.
--   * The legacy free-text `profiles.location` column is preserved as-is.
--     Existing values are never parsed, normalized, or auto-migrated into
--     `country_code`.
--   * No profile policy or grant is modified. `application_contact_email`
--     stays covered by the existing owner-only profiles policies; anon has
--     no grants on `profiles`.
--   * No country is special-cased for US / GB / CA anywhere in this file.
--     Their prominence is a frontend-only ordering concern.
--   * `application_contact_email` stores a contact address for filling job
--     applications only. No mail access, message reading, or provider sync
--     is introduced here.

CREATE TABLE IF NOT EXISTS public.countries (
  "code"              text                    NOT NULL,
  "name"              text                    NOT NULL
                        CONSTRAINT "countries_name_check"
                          CHECK (length("name") > 0),
  "default_currency"  text                    NOT NULL
                        CONSTRAINT "countries_default_currency_check"
                          CHECK ("default_currency" ~ '^[A-Z]{3}$'),
  "default_locale"    text                    NOT NULL
                        CONSTRAINT "countries_default_locale_check"
                          CHECK ("default_locale" ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  "calling_code"      text
                        CONSTRAINT "countries_calling_code_check"
                          CHECK ("calling_code" IS NULL OR "calling_code" ~ '^\+[0-9]{1,6}$'),
  "active"            boolean                 NOT NULL DEFAULT true,
  "created_at"        timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"        timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "countries_pkey" PRIMARY KEY ("code"),
  CONSTRAINT "countries_code_check" CHECK ("code" ~ '^[A-Z]{2}$')
);

-- Publicly readable reference data (onboarding pickers, logged-out pages).
-- Read-only for clients: no INSERT/UPDATE/DELETE policy exists, so only the
-- service role (which bypasses RLS) can ever modify the canonical dataset.
ALTER TABLE public.countries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "countries_select_public"
  ON public.countries
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- The Supabase platform auto-grants anon/authenticated default write
-- privileges on new public objects. Scope them back to read-only access.
REVOKE ALL ON TABLE public.countries FROM anon;
REVOKE ALL ON TABLE public.countries FROM authenticated;
GRANT SELECT ON TABLE public.countries TO anon, authenticated;
GRANT ALL ON TABLE public.countries TO postgres, service_role;

COMMENT ON TABLE public.countries IS
  'Canonical ISO 3166-1 alpha-2 country reference data. Readable by everyone, writable only server-side.';
INSERT INTO public.countries (code, name, default_currency, default_locale, calling_code, active)
VALUES
  ('AD', 'Andorra', 'EUR', 'ca-AD', '+376', true),
  ('AE', 'United Arab Emirates', 'AED', 'ar-AE', '+971', true),
  ('AF', 'Afghanistan', 'AFN', 'ps-AF', '+93', true),
  ('AG', 'Antigua and Barbuda', 'XCD', 'en-AG', '+1268', true),
  ('AI', 'Anguilla', 'XCD', 'en-AI', '+1264', true),
  ('AL', 'Albania', 'ALL', 'sq-AL', '+355', true),
  ('AM', 'Armenia', 'AMD', 'hy-AM', '+374', true),
  ('AO', 'Angola', 'AOA', 'pt-AO', '+244', true),
  ('AQ', 'Antarctica', 'USD', 'en-AQ', NULL, false),
  ('AR', 'Argentina', 'ARS', 'es-AR', '+54', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.countries (code, name, default_currency, default_locale, calling_code, active)
VALUES
  ('AS', 'American Samoa', 'USD', 'en-AS', '+1684', true),
  ('AT', 'Austria', 'EUR', 'de-AT', '+43', true),
  ('AU', 'Australia', 'AUD', 'en-AU', '+61', true),
  ('AW', 'Aruba', 'AWG', 'nl-AW', '+297', true),
  ('AX', 'Åland Islands', 'EUR', 'sv-AX', '+358', false),
  ('AZ', 'Azerbaijan', 'AZN', 'az-AZ', '+994', true),
  ('BA', 'Bosnia and Herzegovina', 'BAM', 'bs-BA', '+387', true),
  ('BB', 'Barbados', 'BBD', 'en-BB', '+1246', true),
  ('BD', 'Bangladesh', 'BDT', 'bn-BD', '+880', true),
  ('BE', 'Belgium', 'EUR', 'nl-BE', '+32', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.countries (code, name, default_currency, default_locale, calling_code, active)
VALUES
  ('BF', 'Burkina Faso', 'XOF', 'fr-BF', '+226', true),
  ('BG', 'Bulgaria', 'EUR', 'bg-BG', '+359', true),
  ('BH', 'Bahrain', 'BHD', 'ar-BH', '+973', true),
  ('BI', 'Burundi', 'BIF', 'fr-BI', '+257', true),
  ('BJ', 'Benin', 'XOF', 'fr-BJ', '+229', true),
  ('BL', 'Saint Barthélemy', 'EUR', 'fr-BL', '+590', false),
  ('BM', 'Bermuda', 'BMD', 'en-BM', '+1441', true),
  ('BN', 'Brunei', 'BND', 'ms-BN', '+673', true),
  ('BO', 'Bolivia', 'BOB', 'es-BO', '+591', true),
  ('BQ', 'Caribbean Netherlands', 'USD', 'en-BQ', '+599', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.countries (code, name, default_currency, default_locale, calling_code, active)
VALUES
  ('BR', 'Brazil', 'BRL', 'pt-BR', '+55', true),
  ('BS', 'Bahamas', 'BSD', 'en-BS', '+1242', true),
  ('BT', 'Bhutan', 'BTN', 'dz-BT', '+975', true),
  ('BV', 'Bouvet Island', 'NOK', 'no-BV', '+47', false),
  ('BW', 'Botswana', 'BWP', 'en-BW', '+267', true),
  ('BY', 'Belarus', 'BYN', 'be-BY', '+375', true),
  ('BZ', 'Belize', 'BZD', 'en-BZ', '+501', true),
  ('CA', 'Canada', 'CAD', 'en-CA', '+1', true),
  ('CC', 'Cocos (Keeling) Islands', 'AUD', 'en-CC', '+61', true),
  ('CD', 'DR Congo', 'CDF', 'fr-CD', '+243', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.countries (code, name, default_currency, default_locale, calling_code, active)
VALUES
  ('CF', 'Central African Republic', 'XAF', 'fr-CF', '+236', true),
  ('CG', 'Congo', 'XAF', 'fr-CG', '+242', true),
  ('CH', 'Switzerland', 'CHF', 'de-CH', '+41', true),
  ('CI', 'Ivory Coast', 'XOF', 'fr-CI', '+225', true),
  ('CK', 'Cook Islands', 'NZD', 'en-CK', '+682', true),
  ('CL', 'Chile', 'CLP', 'es-CL', '+56', true),
  ('CM', 'Cameroon', 'XAF', 'fr-CM', '+237', true),
  ('CN', 'China', 'CNY', 'zh-CN', '+86', true),
  ('CO', 'Colombia', 'COP', 'es-CO', '+57', true),
  ('CR', 'Costa Rica', 'CRC', 'es-CR', '+506', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.countries (code, name, default_currency, default_locale, calling_code, active)
VALUES
  ('CU', 'Cuba', 'CUP', 'es-CU', '+53', true),
  ('CV', 'Cape Verde', 'CVE', 'pt-CV', '+238', true),
  ('CW', 'Curaçao', 'ANG', 'en-CW', '+599', false),
  ('CX', 'Christmas Island', 'AUD', 'en-CX', '+61', true),
  ('CY', 'Cyprus', 'EUR', 'el-CY', '+357', true),
  ('CZ', 'Czechia', 'CZK', 'cs-CZ', '+420', true),
  ('DE', 'Germany', 'EUR', 'de-DE', '+49', true),
  ('DJ', 'Djibouti', 'DJF', 'ar-DJ', '+253', true),
  ('DK', 'Denmark', 'DKK', 'da-DK', '+45', true),
  ('DM', 'Dominica', 'XCD', 'en-DM', '+1767', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.countries (code, name, default_currency, default_locale, calling_code, active)
VALUES
  ('DO', 'Dominican Republic', 'DOP', 'es-DO', '+1', true),
  ('DZ', 'Algeria', 'DZD', 'ar-DZ', '+213', true),
  ('EC', 'Ecuador', 'USD', 'es-EC', '+593', true),
  ('EE', 'Estonia', 'EUR', 'et-EE', '+372', true),
  ('EG', 'Egypt', 'EGP', 'ar-EG', '+20', true),
  ('EH', 'Western Sahara', 'MAD', 'ar-EH', '+212', true),
  ('ER', 'Eritrea', 'ERN', 'ar-ER', '+291', true),
  ('ES', 'Spain', 'EUR', 'es-ES', '+34', true),
  ('ET', 'Ethiopia', 'ETB', 'am-ET', '+251', true),
  ('FI', 'Finland', 'EUR', 'fi-FI', '+358', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.countries (code, name, default_currency, default_locale, calling_code, active)
VALUES
  ('FJ', 'Fiji', 'FJD', 'en-FJ', '+679', true),
  ('FK', 'Falkland Islands', 'FKP', 'en-FK', '+500', true),
  ('FM', 'Micronesia', 'USD', 'en-FM', '+691', true),
  ('FO', 'Faroe Islands', 'DKK', 'da-FO', '+298', true),
  ('FR', 'France', 'EUR', 'fr-FR', '+33', true),
  ('GA', 'Gabon', 'XAF', 'fr-GA', '+241', true),
  ('GB', 'United Kingdom', 'GBP', 'en-GB', '+44', true),
  ('GD', 'Grenada', 'XCD', 'en-GD', '+1473', true),
  ('GE', 'Georgia', 'GEL', 'ka-GE', '+995', true),
  ('GF', 'French Guiana', 'EUR', 'fr-GF', '+594', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.countries (code, name, default_currency, default_locale, calling_code, active)
VALUES
  ('GG', 'Guernsey', 'GBP', 'en-GG', '+44', true),
  ('GH', 'Ghana', 'GHS', 'en-GH', '+233', true),
  ('GI', 'Gibraltar', 'GIP', 'en-GI', '+350', true),
  ('GL', 'Greenland', 'DKK', 'kl-GL', '+299', true),
  ('GM', 'Gambia', 'GMD', 'en-GM', '+220', true),
  ('GN', 'Guinea', 'GNF', 'fr-GN', '+224', true),
  ('GP', 'Guadeloupe', 'EUR', 'fr-GP', '+590', true),
  ('GQ', 'Equatorial Guinea', 'XAF', 'es-GQ', '+240', true),
  ('GR', 'Greece', 'EUR', 'el-GR', '+30', true),
  ('GS', 'South Georgia', 'SHP', 'en-GS', '+500', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.countries (code, name, default_currency, default_locale, calling_code, active)
VALUES
  ('GT', 'Guatemala', 'GTQ', 'es-GT', '+502', true),
  ('GU', 'Guam', 'USD', 'en-GU', '+1671', true),
  ('GW', 'Guinea-Bissau', 'XOF', 'pt-GW', '+245', true),
  ('GY', 'Guyana', 'GYD', 'en-GY', '+592', true),
  ('HK', 'Hong Kong', 'HKD', 'zh-HK', '+852', true),
  ('HM', 'Heard Island and McDonald Islands', 'AUD', 'en-HM', NULL, false),
  ('HN', 'Honduras', 'HNL', 'es-HN', '+504', true),
  ('HR', 'Croatia', 'EUR', 'hr-HR', '+385', true),
  ('HT', 'Haiti', 'HTG', 'fr-HT', '+509', true),
  ('HU', 'Hungary', 'HUF', 'hu-HU', '+36', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.countries (code, name, default_currency, default_locale, calling_code, active)
VALUES
  ('ID', 'Indonesia', 'IDR', 'id-ID', '+62', true),
  ('IE', 'Ireland', 'EUR', 'en-IE', '+353', true),
  ('IL', 'Israel', 'ILS', 'he-IL', '+972', true),
  ('IM', 'Isle of Man', 'GBP', 'en-IM', '+44', true),
  ('IN', 'India', 'INR', 'en-IN', '+91', true),
  ('IO', 'British Indian Ocean Territory', 'USD', 'en-IO', '+246', true),
  ('IQ', 'Iraq', 'IQD', 'ar-IQ', '+964', true),
  ('IR', 'Iran', 'IRR', 'fa-IR', '+98', true),
  ('IS', 'Iceland', 'ISK', 'is-IS', '+354', true),
  ('IT', 'Italy', 'EUR', 'it-IT', '+39', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.countries (code, name, default_currency, default_locale, calling_code, active)
VALUES
  ('JE', 'Jersey', 'GBP', 'en-JE', '+44', true),
  ('JM', 'Jamaica', 'JMD', 'en-JM', '+1876', true),
  ('JO', 'Jordan', 'JOD', 'ar-JO', '+962', true),
  ('JP', 'Japan', 'JPY', 'ja-JP', '+81', true),
  ('KE', 'Kenya', 'KES', 'en-KE', '+254', true),
  ('KG', 'Kyrgyzstan', 'KGS', 'ky-KG', '+996', true),
  ('KH', 'Cambodia', 'KHR', 'km-KH', '+855', true),
  ('KI', 'Kiribati', 'AUD', 'en-KI', '+686', true),
  ('KM', 'Comoros', 'KMF', 'ar-KM', '+269', true),
  ('KN', 'Saint Kitts and Nevis', 'XCD', 'en-KN', '+1869', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.countries (code, name, default_currency, default_locale, calling_code, active)
VALUES
  ('KP', 'North Korea', 'KPW', 'ko-KP', '+850', true),
  ('KR', 'South Korea', 'KRW', 'ko-KR', '+82', true),
  ('KW', 'Kuwait', 'KWD', 'ar-KW', '+965', true),
  ('KY', 'Cayman Islands', 'KYD', 'en-KY', '+1345', true),
  ('KZ', 'Kazakhstan', 'KZT', 'kk-KZ', '+7', true),
  ('LA', 'Laos', 'LAK', 'lo-LA', '+856', true),
  ('LB', 'Lebanon', 'LBP', 'ar-LB', '+961', true),
  ('LC', 'Saint Lucia', 'XCD', 'en-LC', '+1758', true),
  ('LI', 'Liechtenstein', 'CHF', 'de-LI', '+423', true),
  ('LK', 'Sri Lanka', 'LKR', 'si-LK', '+94', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.countries (code, name, default_currency, default_locale, calling_code, active)
VALUES
  ('LR', 'Liberia', 'LRD', 'en-LR', '+231', true),
  ('LS', 'Lesotho', 'LSL', 'en-LS', '+266', true),
  ('LT', 'Lithuania', 'EUR', 'lt-LT', '+370', true),
  ('LU', 'Luxembourg', 'EUR', 'de-LU', '+352', true),
  ('LV', 'Latvia', 'EUR', 'lv-LV', '+371', true),
  ('LY', 'Libya', 'LYD', 'ar-LY', '+218', true),
  ('MA', 'Morocco', 'MAD', 'ar-MA', '+212', true),
  ('MC', 'Monaco', 'EUR', 'fr-MC', '+377', true),
  ('MD', 'Moldova', 'MDL', 'ro-MD', '+373', true),
  ('ME', 'Montenegro', 'EUR', 'cnr-ME', '+382', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.countries (code, name, default_currency, default_locale, calling_code, active)
VALUES
  ('MF', 'Saint Martin', 'EUR', 'fr-MF', '+590', true),
  ('MG', 'Madagascar', 'MGA', 'fr-MG', '+261', true),
  ('MH', 'Marshall Islands', 'USD', 'en-MH', '+692', true),
  ('MK', 'North Macedonia', 'MKD', 'mk-MK', '+389', true),
  ('ML', 'Mali', 'XOF', 'fr-ML', '+223', true),
  ('MM', 'Myanmar', 'MMK', 'my-MM', '+95', true),
  ('MN', 'Mongolia', 'MNT', 'mn-MN', '+976', true),
  ('MO', 'Macau', 'MOP', 'zh-MO', '+853', true),
  ('MP', 'Northern Mariana Islands', 'USD', 'en-MP', '+1670', true),
  ('MQ', 'Martinique', 'EUR', 'fr-MQ', '+596', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.countries (code, name, default_currency, default_locale, calling_code, active)
VALUES
  ('MR', 'Mauritania', 'MRU', 'ar-MR', '+222', true),
  ('MS', 'Montserrat', 'XCD', 'en-MS', '+1664', true),
  ('MT', 'Malta', 'EUR', 'en-MT', '+356', true),
  ('MU', 'Mauritius', 'MUR', 'en-MU', '+230', true),
  ('MV', 'Maldives', 'MVR', 'dv-MV', '+960', true),
  ('MW', 'Malawi', 'MWK', 'en-MW', '+265', true),
  ('MX', 'Mexico', 'MXN', 'es-MX', '+52', true),
  ('MY', 'Malaysia', 'MYR', 'ms-MY', '+60', true),
  ('MZ', 'Mozambique', 'MZN', 'pt-MZ', '+258', true),
  ('NA', 'Namibia', 'NAD', 'en-NA', '+264', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.countries (code, name, default_currency, default_locale, calling_code, active)
VALUES
  ('NC', 'New Caledonia', 'XPF', 'fr-NC', '+687', true),
  ('NE', 'Niger', 'XOF', 'fr-NE', '+227', true),
  ('NF', 'Norfolk Island', 'AUD', 'en-NF', '+672', true),
  ('NG', 'Nigeria', 'NGN', 'en-NG', '+234', true),
  ('NI', 'Nicaragua', 'NIO', 'es-NI', '+505', true),
  ('NL', 'Netherlands', 'EUR', 'nl-NL', '+31', true),
  ('NO', 'Norway', 'NOK', 'nb-NO', '+47', true),
  ('NP', 'Nepal', 'NPR', 'ne-NP', '+977', true),
  ('NR', 'Nauru', 'AUD', 'en-NR', '+674', true),
  ('NU', 'Niue', 'NZD', 'en-NU', '+683', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.countries (code, name, default_currency, default_locale, calling_code, active)
VALUES
  ('NZ', 'New Zealand', 'NZD', 'en-NZ', '+64', true),
  ('OM', 'Oman', 'OMR', 'ar-OM', '+968', true),
  ('PA', 'Panama', 'PAB', 'es-PA', '+507', true),
  ('PE', 'Peru', 'PEN', 'es-PE', '+51', true),
  ('PF', 'French Polynesia', 'XPF', 'fr-PF', '+689', true),
  ('PG', 'Papua New Guinea', 'PGK', 'en-PG', '+675', true),
  ('PH', 'Philippines', 'PHP', 'en-PH', '+63', true),
  ('PK', 'Pakistan', 'PKR', 'en-PK', '+92', true),
  ('PL', 'Poland', 'PLN', 'pl-PL', '+48', true),
  ('PM', 'Saint Pierre and Miquelon', 'EUR', 'fr-PM', '+508', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.countries (code, name, default_currency, default_locale, calling_code, active)
VALUES
  ('PN', 'Pitcairn Islands', 'NZD', 'en-PN', '+64', true),
  ('PR', 'Puerto Rico', 'USD', 'es-PR', '+1', true),
  ('PS', 'Palestine', 'ILS', 'ar-PS', '+970', true),
  ('PT', 'Portugal', 'EUR', 'pt-PT', '+351', true),
  ('PW', 'Palau', 'USD', 'en-PW', '+680', true),
  ('PY', 'Paraguay', 'PYG', 'es-PY', '+595', true),
  ('QA', 'Qatar', 'QAR', 'ar-QA', '+974', true),
  ('RE', 'Réunion', 'EUR', 'fr-RE', '+262', false),
  ('RO', 'Romania', 'RON', 'ro-RO', '+40', true),
  ('RS', 'Serbia', 'RSD', 'sr-RS', '+381', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.countries (code, name, default_currency, default_locale, calling_code, active)
VALUES
  ('RU', 'Russia', 'RUB', 'ru-RU', '+7', true),
  ('RW', 'Rwanda', 'RWF', 'en-RW', '+250', true),
  ('SA', 'Saudi Arabia', 'SAR', 'ar-SA', '+966', true),
  ('SB', 'Solomon Islands', 'SBD', 'en-SB', '+677', true),
  ('SC', 'Seychelles', 'SCR', 'en-SC', '+248', true),
  ('SD', 'Sudan', 'SDG', 'ar-SD', '+249', true),
  ('SE', 'Sweden', 'SEK', 'sv-SE', '+46', true),
  ('SG', 'Singapore', 'SGD', 'en-SG', '+65', true),
  ('SH', 'Saint Helena, Ascension and Tristan da Cunha', 'GBP', 'en-SH', '+290', true),
  ('SI', 'Slovenia', 'EUR', 'sl-SI', '+386', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.countries (code, name, default_currency, default_locale, calling_code, active)
VALUES
  ('SJ', 'Svalbard and Jan Mayen', 'NOK', 'no-SJ', '+47', true),
  ('SK', 'Slovakia', 'EUR', 'sk-SK', '+421', true),
  ('SL', 'Sierra Leone', 'SLE', 'en-SL', '+232', true),
  ('SM', 'San Marino', 'EUR', 'it-SM', '+378', true),
  ('SN', 'Senegal', 'XOF', 'fr-SN', '+221', true),
  ('SO', 'Somalia', 'SOS', 'ar-SO', '+252', true),
  ('SR', 'Suriname', 'SRD', 'nl-SR', '+597', true),
  ('SS', 'South Sudan', 'SSP', 'en-SS', '+211', true),
  ('ST', 'São Tomé and Príncipe', 'STN', 'pt-ST', '+239', false),
  ('SV', 'El Salvador', 'USD', 'es-SV', '+503', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.countries (code, name, default_currency, default_locale, calling_code, active)
VALUES
  ('SX', 'Sint Maarten', 'ANG', 'en-SX', '+1721', true),
  ('SY', 'Syria', 'SYP', 'ar-SY', '+963', true),
  ('SZ', 'Eswatini', 'SZL', 'en-SZ', '+268', true),
  ('TC', 'Turks and Caicos Islands', 'USD', 'en-TC', '+1649', true),
  ('TD', 'Chad', 'XAF', 'ar-TD', '+235', true),
  ('TF', 'French Southern and Antarctic Lands', 'EUR', 'fr-TF', '+262', true),
  ('TG', 'Togo', 'XOF', 'fr-TG', '+228', true),
  ('TH', 'Thailand', 'THB', 'th-TH', '+66', true),
  ('TJ', 'Tajikistan', 'TJS', 'tg-TJ', '+992', true),
  ('TK', 'Tokelau', 'NZD', 'en-TK', '+690', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.countries (code, name, default_currency, default_locale, calling_code, active)
VALUES
  ('TL', 'Timor-Leste', 'USD', 'pt-TL', '+670', true),
  ('TM', 'Turkmenistan', 'TMT', 'tk-TM', '+993', true),
  ('TN', 'Tunisia', 'TND', 'ar-TN', '+216', true),
  ('TO', 'Tonga', 'TOP', 'en-TO', '+676', true),
  ('TR', 'Türkiye', 'TRY', 'tr-TR', '+90', true),
  ('TT', 'Trinidad and Tobago', 'TTD', 'en-TT', '+1868', true),
  ('TV', 'Tuvalu', 'AUD', 'en-TV', '+688', true),
  ('TW', 'Taiwan', 'TWD', 'zh-TW', '+886', true),
  ('TZ', 'Tanzania', 'TZS', 'sw-TZ', '+255', true),
  ('UA', 'Ukraine', 'UAH', 'uk-UA', '+380', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.countries (code, name, default_currency, default_locale, calling_code, active)
VALUES
  ('UG', 'Uganda', 'UGX', 'en-UG', '+256', true),
  ('UM', 'United States Minor Outlying Islands', 'USD', 'en-UM', '+268', false),
  ('US', 'United States', 'USD', 'en-US', '+1', true),
  ('UY', 'Uruguay', 'UYU', 'es-UY', '+598', true),
  ('UZ', 'Uzbekistan', 'UZS', 'uz-UZ', '+998', true),
  ('VA', 'Vatican City', 'EUR', 'it-VA', '+39', true),
  ('VC', 'Saint Vincent and the Grenadines', 'XCD', 'en-VC', '+1784', true),
  ('VE', 'Venezuela', 'VES', 'es-VE', '+58', true),
  ('VG', 'British Virgin Islands', 'USD', 'en-VG', '+1284', true),
  ('VI', 'United States Virgin Islands', 'USD', 'en-VI', '+1340', true)
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.countries (code, name, default_currency, default_locale, calling_code, active)
VALUES
  ('VN', 'Vietnam', 'VND', 'vi-VN', '+84', true),
  ('VU', 'Vanuatu', 'VUV', 'bi-VU', '+678', true),
  ('WF', 'Wallis and Futuna', 'XPF', 'fr-WF', '+681', true),
  ('WS', 'Samoa', 'WST', 'en-WS', '+685', true),
  ('XK', 'Kosovo', 'EUR', 'sq-XK', '+383', true),
  ('YE', 'Yemen', 'YER', 'ar-YE', '+967', true),
  ('YT', 'Mayotte', 'EUR', 'fr-YT', '+262', true),
  ('ZA', 'South Africa', 'ZAR', 'en-ZA', '+27', true),
  ('ZM', 'Zambia', 'ZMW', 'en-ZM', '+260', true),
  ('ZW', 'Zimbabwe', 'USD', 'en-ZW', '+263', true)
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- profiles: six nullable localization columns (purely additive).
-- ---------------------------------------------------------------------------
-- All columns are nullable with no defaults, so every existing row and every
-- existing query keeps working unchanged. NULL simply means "not set yet".

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS country_code text
    CONSTRAINT "profiles_country_code_fkey"
      REFERENCES public.countries ("code") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS locale text,
  ADD COLUMN IF NOT EXISTS preferred_currency text,
  ADD COLUMN IF NOT EXISTS timezone text,
  ADD COLUMN IF NOT EXISTS preferred_language text,
  ADD COLUMN IF NOT EXISTS application_contact_email text;

-- Format guards mirror the application-side validation. Existing rows are all
-- NULL, so these validate instantly.
ALTER TABLE public.profiles
  ADD CONSTRAINT "profiles_country_code_check"
    CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT "profiles_locale_check"
    CHECK (locale IS NULL OR locale ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  ADD CONSTRAINT "profiles_preferred_currency_check"
    CHECK (preferred_currency IS NULL OR preferred_currency ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "profiles_timezone_check"
    CHECK (
      timezone IS NULL
      OR (
        length(timezone) <= 64
        AND timezone ~ '^[A-Za-z0-9_+.-]+(/[A-Za-z0-9_+.-]+)*$'
      )
    ),
  ADD CONSTRAINT "profiles_preferred_language_check"
    CHECK (preferred_language IS NULL OR preferred_language ~ '^[a-z]{2,3}$'),
  ADD CONSTRAINT "profiles_application_contact_email_check"
    CHECK (
      application_contact_email IS NULL
      OR (
        length(application_contact_email) <= 320
        AND application_contact_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
      )
    );

-- Keep FK lookups off the profiles heap scan path for the rare country filter.
CREATE INDEX IF NOT EXISTS "profiles_country_code_idx"
  ON public.profiles (country_code)
  WHERE country_code IS NOT NULL;

COMMENT ON COLUMN public.profiles.country_code IS
  'ISO 3166-1 alpha-2 code chosen in settings. NULL when unset; the free-text location column remains the legacy source.';
COMMENT ON COLUMN public.profiles.application_contact_email IS
  'Contact address used only when Odesseus submits job applications so recruiters can reach the candidate. Never used for mail access or message detection.';
