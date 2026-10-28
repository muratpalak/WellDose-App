-- WellDose Web Push setup. Run once in the WellDose project's SQL Editor.
-- The browser only manages subscriptions belonging to the signed-in user.
-- Delivery history is restricted to the server-side scheduler.
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth_secret text not null,
  expiration_time bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint push_endpoint_https check (endpoint ~ '^https://'),
  constraint push_key_sizes check (length(p256dh) between 40 and 200 and length(auth_secret) between 12 and 100)
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
drop policy if exists "push_subscriptions_select_own" on public.push_subscriptions;
create policy "push_subscriptions_select_own" on public.push_subscriptions for select to authenticated
  using ((select auth.uid())=user_id);
drop policy if exists "push_subscriptions_insert_own" on public.push_subscriptions;
create policy "push_subscriptions_insert_own" on public.push_subscriptions for insert to authenticated
  with check ((select auth.uid())=user_id);
drop policy if exists "push_subscriptions_update_own" on public.push_subscriptions;
create policy "push_subscriptions_update_own" on public.push_subscriptions for update to authenticated
  using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
drop policy if exists "push_subscriptions_delete_own" on public.push_subscriptions;
create policy "push_subscriptions_delete_own" on public.push_subscriptions for delete to authenticated
  using ((select auth.uid())=user_id);
revoke all on public.push_subscriptions from anon;
grant select,insert,update,delete on public.push_subscriptions to authenticated;

create table if not exists public.push_deliveries (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  reminder_id uuid not null,
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  scheduled_at timestamptz not null,
  delivered_at timestamptz,
  unique (user_id,reminder_id,scheduled_at,subscription_id)
);
create index if not exists push_deliveries_time_idx on public.push_deliveries (scheduled_at);
alter table public.push_deliveries enable row level security;
-- No browser policies. Only a privileged Edge Function may read/write this table.
revoke all on public.push_deliveries from anon,authenticated;

-- Verification queries (should show true for both table RLS flags):
-- select relname, relrowsecurity from pg_class where oid in
--   ('public.push_subscriptions'::regclass,'public.push_deliveries'::regclass);
