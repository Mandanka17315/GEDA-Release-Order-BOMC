-- =====================================================================
--  GEDA RO Tool – Supabase database
--  Run this whole file once in Supabase › SQL Editor › New query › Run.
--  It is safe to run again: it only creates what is missing and
--  replaces the functions and policies.
-- =====================================================================

-- ---------- tables ----------------------------------------------------

-- People who may log in as Admin (Release Orders, imports, settings).
create table if not exists public.admins (
  email text primary key
);

-- Master sheet: one row per Release Order / application
create table if not exists public.master (
  app_no      text primary key,               -- "GUJ/RT/COM/10275165" exactly as on the portal
  app_key     text generated always as (upper(regexp_replace(app_no, '\s', '', 'g'))) stored unique,
  sr          integer,
  reg text, cons text, name text, pv text, ex text, cl text, cat text, div text, sdn text,
  addr text, taluka text, village text, cei text, status text,
  agr         text,                           -- agreement date, YYYY-MM-DD
  pmake text, pwatt text, pnos text, ptot text, imake text, icap text, icheck text, volt text, isr text,
  meter text, meter_r text, test text, test_r text, conn text, conn_r text, ss text, ss_r text,
  agr_yes text, ro_no text,
  ro_date     text,                           -- YYYY-MM-DD
  bidir       text,                           -- 'Pending' | meter date YYYY-MM-DD | other text (e.g. RO Cancelled)
  eurja text, general text, tariff text, msme text, policy text, remark text,
  installer text, ro_type text, gen_meter text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  text
);
create index if not exists master_bidir_idx on public.master (bidir);
create index if not exists master_div_idx on public.master (div);

-- GEDA portal download (GEDA FORMAT sheet). Whole row is kept in "data".
create table if not exists public.geda (
  app_key     text primary key,
  app_no      text not null,
  status      text, category text, name text, cons text, div text, sdn text,
  pv text, ex text, cl text, installer text,
  meter_date  text,                           -- portal "Date of Installation of Solar Meter"
  cei_date    text,
  data        jsonb not null default '{}'::jsonb,
  imported_at timestamptz not null default now()
);
create index if not exists geda_status_idx on public.geda (status);

create table if not exists public.sdn_code (
  code text primary key,
  name text not null
);

create table if not exists public.settings (
  key   text primary key,
  value jsonb
);

create table if not exists public.activity (
  id      bigserial primary key,
  at      timestamptz not null default now(),
  app_no  text,
  action  text,
  by_name text,
  detail  jsonb
);
create index if not exists activity_at_idx on public.activity (at desc);

-- keep updated_at current
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
drop trigger if exists master_touch on public.master;
create trigger master_touch before update on public.master
  for each row execute function public.touch_updated_at();

-- ---------- who is admin ----------------------------------------------
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.admins
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- ---------- row level security ----------------------------------------
alter table public.admins   enable row level security;
alter table public.master   enable row level security;
alter table public.geda     enable row level security;
alter table public.sdn_code enable row level security;
alter table public.settings enable row level security;
alter table public.activity enable row level security;

drop policy if exists admin_all on public.admins;
create policy admin_all on public.admins   for select to authenticated using (public.is_admin());
drop policy if exists admin_all on public.master;
create policy admin_all on public.master   for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists admin_all on public.geda;
create policy admin_all on public.geda     for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists admin_all on public.sdn_code;
create policy admin_all on public.sdn_code for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists admin_all on public.settings;
create policy admin_all on public.settings for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists admin_all on public.activity;
create policy admin_all on public.activity for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Field offices (no login) may read sub-division names and the charge rates only.
drop policy if exists public_read on public.sdn_code;
create policy public_read on public.sdn_code for select to anon, authenticated using (true);
drop policy if exists public_read on public.settings;
create policy public_read on public.settings for select to anon, authenticated using (key = 'rates');

grant select on public.sdn_code, public.settings to anon;
grant select, insert, update, delete on public.master, public.geda, public.sdn_code, public.settings, public.activity to authenticated;
grant select on public.admins to authenticated;
grant usage, select on sequence public.activity_id_seq to authenticated;

-- ---------- field office functions (work without login) ---------------

-- Pending release list, with the portal's meter date when the portal has one
create or replace function public.pending_list()
returns table (
  app_no text, name text, cons text, pv text, ex text, cl text, div text, sdn text, village text,
  ro_date text, remark text, eurja text, tariff text, updated_by text, updated_at timestamptz,
  portal_status text, portal_meter_date text
)
language sql stable security definer set search_path = public as $$
  select m.app_no, m.name, m.cons, m.pv, m.ex, m.cl, m.div, m.sdn, m.village,
         m.ro_date, m.remark, m.eurja, m.tariff, m.updated_by, m.updated_at,
         g.status, g.meter_date
  from public.master m
  left join public.geda g on g.app_key = m.app_key
  where lower(trim(coalesce(m.bidir, ''))) = 'pending'
  order by m.ro_date nulls last, m.app_no;
$$;

-- Field entry against a pending RO: meter installation date and/or reason
create or replace function public.field_update(p_app text, p_meter_date date, p_reason text, p_by text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  r public.master%rowtype;
  who text := left(trim(coalesce(p_by, '')), 60);
begin
  if length(who) < 2 then raise exception 'Enter your name before saving.'; end if;
  select * into r from public.master where app_no = p_app for update;
  if not found then raise exception 'Application % not found.', p_app; end if;
  if lower(trim(coalesce(r.bidir, ''))) <> 'pending' then
    raise exception 'Application % is no longer pending.', p_app;
  end if;
  if p_meter_date is not null then
    if p_meter_date > (now() at time zone 'Asia/Kolkata')::date then raise exception 'Meter date cannot be in the future.'; end if;
    if p_meter_date < date '2015-01-01' then raise exception 'Meter date looks wrong.'; end if;
  end if;
  update public.master set
    bidir      = case when p_meter_date is not null then to_char(p_meter_date, 'YYYY-MM-DD') else bidir end,
    remark     = case when p_reason is not null then left(trim(p_reason), 300) else remark end,
    updated_by = who
  where app_no = p_app;
  insert into public.activity (app_no, action, by_name, detail)
  values (p_app, case when p_meter_date is not null then 'released' else 'reason' end, who,
          jsonb_build_object('meter_date', p_meter_date, 'reason', p_reason, 'old_reason', r.remark));
  return 'ok';
end $$;

revoke all on function public.pending_list() from public;
revoke all on function public.field_update(text, date, text, text) from public;
grant execute on function public.pending_list() to anon, authenticated;
grant execute on function public.field_update(text, date, text, text) to anon, authenticated;
grant execute on function public.is_admin() to anon, authenticated;

-- =====================================================================
--  LAST STEP – put your own admin e-mail here (same e-mail you add under
--  Authentication › Users), then run this line:
--
--  insert into public.admins (email) values ('your.email@example.com') on conflict do nothing;
-- =====================================================================
