create policy "admin_users_deny_browser_access" on public.admin_users
  for all to anon, authenticated using (false) with check (false);
create policy "partner_applications_deny_browser_access" on public.partner_applications
  for all to anon, authenticated using (false) with check (false);
create policy "partners_deny_browser_access" on public.partners
  for all to anon, authenticated using (false) with check (false);
create policy "partner_social_accounts_deny_browser_access" on public.partner_social_accounts
  for all to anon, authenticated using (false) with check (false);
create policy "partner_referrals_deny_browser_access" on public.partner_referrals
  for all to anon, authenticated using (false) with check (false);
create policy "partner_conversions_deny_browser_access" on public.partner_conversions
  for all to anon, authenticated using (false) with check (false);
create policy "partner_campaigns_deny_browser_access" on public.partner_campaigns
  for all to anon, authenticated using (false) with check (false);
create policy "partner_campaign_members_deny_browser_access" on public.partner_campaign_members
  for all to anon, authenticated using (false) with check (false);
create policy "partner_content_deny_browser_access" on public.partner_content
  for all to anon, authenticated using (false) with check (false);
create policy "partner_earnings_deny_browser_access" on public.partner_earnings
  for all to anon, authenticated using (false) with check (false);
create policy "partner_payouts_deny_browser_access" on public.partner_payouts
  for all to anon, authenticated using (false) with check (false);
