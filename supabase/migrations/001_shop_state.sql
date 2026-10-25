create table public.shop_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  notify_email text,
  rev bigint not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.shop_state enable row level security;
create policy "owner reads own state" on public.shop_state for select to authenticated using ((select auth.uid()) = user_id);
create policy "owner inserts own state" on public.shop_state for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "owner updates own state" on public.shop_state for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create or replace function public.touch_shop_state() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); new.rev := coalesce(old.rev, 0) + 1; return new; end $$;
create trigger shop_state_touch before update on public.shop_state for each row execute function public.touch_shop_state();
alter publication supabase_realtime add table public.shop_state;
