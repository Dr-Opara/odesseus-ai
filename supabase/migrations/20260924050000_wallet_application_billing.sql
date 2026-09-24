create table if not exists public.wallet_balances (
  user_id uuid primary key,
  balance_cents integer not null default 0 check (balance_cents >= 0),
  updated_at timestamptz not null default now()
);
alter table public.wallet_balances enable row level security;
revoke all on table public.wallet_balances from anon, authenticated;
grant select on table public.wallet_balances to authenticated;
grant all on table public.wallet_balances to postgres, service_role;
create policy "wallet_balances_select_own" on public.wallet_balances for select to authenticated using ((select auth.uid())=user_id);

create table if not exists public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  amount_cents integer not null check (amount_cents<>0),
  transaction_type text not null check (transaction_type in ('top_up','apply','smart_apply','refund','adjustment')),
  external_reference text unique,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.wallet_transactions enable row level security;
revoke all on table public.wallet_transactions from anon, authenticated;
grant select on table public.wallet_transactions to authenticated;
grant all on table public.wallet_transactions to postgres, service_role;
create policy "wallet_transactions_select_own" on public.wallet_transactions for select to authenticated using ((select auth.uid())=user_id);
create index wallet_transactions_user_created_idx on public.wallet_transactions(user_id,created_at desc);

create or replace function odesseus_private.apply_wallet_transaction() returns trigger language plpgsql set search_path to 'public','odesseus_private','pg_temp' as $$
declare v_balance integer;
begin
 insert into public.wallet_balances(user_id,balance_cents,updated_at) values(new.user_id,0,now()) on conflict(user_id) do nothing;
 select balance_cents into v_balance from public.wallet_balances where user_id=new.user_id for update;
 if v_balance+new.amount_cents<0 then raise exception 'insufficient wallet balance'; end if;
 update public.wallet_balances set balance_cents=balance_cents+new.amount_cents,updated_at=now() where user_id=new.user_id;
 return new;
end; $$;
create trigger trg_apply_wallet_transaction before insert on public.wallet_transactions for each row execute function odesseus_private.apply_wallet_transaction();

alter table public.application_runs
 add column application_mode text not null default 'smart_apply' check(application_mode in ('apply','smart_apply')),
 add column price_cents integer not null default 199 check(price_cents in (49,199)),
 add column payment_source text not null default 'wallet' check(payment_source in ('wallet','legacy_credit'));

create or replace function odesseus_private.fulfill_billing_event() returns trigger language plpgsql set search_path to 'public','odesseus_private','pg_temp' as $$
begin
 if new.sku='interview_annual' then
  insert into public.credit_balances(user_id,application_credits,interview_passes,live_unlimited_until,updated_at) values(new.user_id,0,0,now()+interval '12 months',now())
  on conflict(user_id) do update set live_unlimited_until=greatest(coalesce(public.credit_balances.live_unlimited_until,now()),now())+interval '12 months',updated_at=now();
 elsif new.sku like 'wallet_%' then
  insert into public.wallet_transactions(user_id,amount_cents,transaction_type,external_reference,metadata)
  values(new.user_id,new.amount_cents,'top_up',new.stripe_event_id,jsonb_build_object('sku',new.sku,'checkout_session_id',new.checkout_session_id,'currency',new.currency,'stripe_customer_id',new.stripe_customer_id)||new.metadata);
 else
  insert into public.credit_transactions(user_id,credit_type,delta,reason,external_reference,amount_cents,metadata)
  values(new.user_id,new.credit_type,new.credit_delta,'stripe_purchase',new.stripe_event_id,new.amount_cents,jsonb_build_object('sku',new.sku,'checkout_session_id',new.checkout_session_id,'currency',new.currency,'stripe_customer_id',new.stripe_customer_id)||new.metadata);
 end if;
 return new;
end; $$;

create or replace function public.odesseus_finalize_successful_application(p_run_id uuid,p_user_id uuid,p_confirmation_text text,p_page_url text default null)
returns table(application_id uuid,run_id uuid,already_finalized boolean) language plpgsql security definer set search_path to 'public','odesseus_private','pg_temp' as $$
declare v_run public.application_runs%rowtype; v_job public.job_opportunities%rowtype; v_application_id uuid; v_now timestamptz:=now();
begin
 select * into v_run from public.application_runs where id=p_run_id and user_id=p_user_id for update;
 if not found then raise exception 'application run not found'; end if;
 if v_run.status='submitted' then select id into v_application_id from public.applications where user_id=p_user_id and job_id=v_run.job_id limit 1; return query select v_application_id,v_run.id,true; return; end if;
 if v_run.status in ('failed','cancelled') then raise exception 'application run cannot be finalized from status %',v_run.status; end if;
 if p_confirmation_text is null or length(trim(p_confirmation_text))=0 then raise exception 'a confirmed submission message is required to finalize'; end if;
 select * into v_job from public.job_opportunities where id=v_run.job_id;
 select id into v_application_id from public.applications where user_id=p_user_id and job_id=v_run.job_id limit 1;
 if v_application_id is not null then
  update public.applications set tailored_resume_id=v_run.approved_resume_id,application_url=v_run.target_url,status='applied',submission_confirmation=p_confirmation_text,submitted_at=v_now,last_event_at=v_now,updated_at=v_now where id=v_application_id;
 else
  insert into public.applications(user_id,job_id,tailored_resume_id,company_name,role_title,application_url,status,submission_confirmation,submitted_at,last_event_at)
  values(p_user_id,v_run.job_id,v_run.approved_resume_id,coalesce(v_job.company_name,'Company'),coalesce(v_job.role_title,'Role'),v_run.target_url,'applied',p_confirmation_text,v_now,v_now) returning id into v_application_id;
 end if;
 if v_run.payment_source='legacy_credit' then
  insert into public.credit_transactions(user_id,credit_type,delta,reason,external_reference,metadata)
  values(p_user_id,'application',-1,'successful_application','application:'||p_run_id::text,jsonb_build_object('application_run_id',p_run_id,'job_id',v_run.job_id,'application_mode',v_run.application_mode,'payment_source','legacy_credit')) on conflict(external_reference) do nothing;
 else
  insert into public.wallet_transactions(user_id,amount_cents,transaction_type,external_reference,metadata)
  values(p_user_id,-v_run.price_cents,case when v_run.application_mode='smart_apply' then 'smart_apply' else 'apply' end,'application:'||p_run_id::text,jsonb_build_object('application_run_id',p_run_id,'job_id',v_run.job_id,'application_mode',v_run.application_mode,'price_cents',v_run.price_cents)) on conflict(external_reference) do nothing;
 end if;
 update public.job_opportunities set status='applied',updated_at=v_now where id=v_run.job_id;
 update public.application_runs set status='submitted',stop_reason=null,submission_confirmation=p_confirmation_text,submission_evidence=jsonb_build_object('after_url',p_page_url,'confirmation_detected',true,'confirmation_text',p_confirmation_text,'application_mode',v_run.application_mode,'price_cents',v_run.price_cents),current_url=coalesce(p_page_url,v_run.current_url),submitted_at=v_now,finished_at=v_now,resume_token=null,updated_at=v_now where id=p_run_id;
 return query select v_application_id,p_run_id,false;
end; $$;
revoke all on function public.odesseus_finalize_successful_application(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.odesseus_finalize_successful_application(uuid,uuid,text,text) to postgres,service_role;
