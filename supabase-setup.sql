create table if not exists public.user_states (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_states enable row level security;

create policy "users_select_own_state" on public.user_states
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "users_insert_own_state" on public.user_states
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "users_update_own_state" on public.user_states
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
