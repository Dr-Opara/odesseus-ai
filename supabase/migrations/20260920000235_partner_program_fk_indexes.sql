create index if not exists partner_applications_reviewed_by_idx
  on public.partner_applications(reviewed_by);
create index if not exists partner_campaigns_created_by_idx
  on public.partner_campaigns(created_by);
create index if not exists partner_content_campaign_idx
  on public.partner_content(campaign_id);
create index if not exists partner_content_reviewed_by_idx
  on public.partner_content(reviewed_by);
create index if not exists partner_conversions_referral_idx
  on public.partner_conversions(referral_id);
create index if not exists partner_earnings_campaign_idx
  on public.partner_earnings(campaign_id);
create index if not exists partner_payouts_recorded_by_idx
  on public.partner_payouts(recorded_by);
