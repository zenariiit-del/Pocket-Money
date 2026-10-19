-- プードル貯金と同じプロジェクトにも追加可能。既存テーブルは変更しません。
begin;
create table if not exists public.allowance_settings (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  start_month date not null default date '2026-09-01',
  check (extract(day from start_month) = 1)
);
create table if not exists public.allowance_entries (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  person text not null check (person in ('Ritsuya', 'honami')),
  entry_date date not null,
  kind text not null check (kind in ('expense', 'refund')),
  cents integer not null check (cents > 0 and cents <= 100000000),
  memo text not null default '' check (length(memo) <= 200),
  version integer not null default 1,
  created_at timestamptz not null default now()
);
create index if not exists allowance_entries_owner_date on public.allowance_entries(owner_id,entry_date);
-- すでに10月開始で使用中のアカウントも、記録を残したまま9月開始に変更。
alter table public.allowance_settings alter column start_month set default date '2026-09-01';
update public.allowance_settings set start_month = date '2026-09-01' where start_month > date '2026-09-01';
alter table public.allowance_settings enable row level security;
alter table public.allowance_entries enable row level security;
drop policy if exists allowance_settings_own on public.allowance_settings;
create policy allowance_settings_own on public.allowance_settings for select to authenticated using (owner_id = (select auth.uid()));
drop policy if exists allowance_settings_create on public.allowance_settings;
create policy allowance_settings_create on public.allowance_settings for insert to authenticated with check (owner_id = (select auth.uid()) and start_month = date '2026-09-01');
drop policy if exists allowance_entries_own on public.allowance_entries;
create policy allowance_entries_own on public.allowance_entries for all to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
grant select, insert on public.allowance_settings to authenticated;
grant select, insert, update, delete on public.allowance_entries to authenticated;
revoke all on public.allowance_settings,public.allowance_entries from anon;

create or replace function public.allowance_snapshot() returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare result jsonb;
begin
  if auth.uid() is null then raise exception 'Login required'; end if;
  insert into public.allowance_settings(owner_id) values(auth.uid()) on conflict do nothing;
  select jsonb_build_object(
    'today', (now() at time zone 'America/New_York')::date,
    'start_month', s.start_month,
    'entries', coalesce((select jsonb_agg(to_jsonb(e) order by e.entry_date desc,e.created_at desc) from public.allowance_entries e where e.owner_id = auth.uid()),'[]'::jsonb)
  ) into result from public.allowance_settings s where s.owner_id = auth.uid();
  return result;
end; $$;

-- 重複送信は同じUUIDで1件だけ保存。編集・削除はバージョンを照合。
create or replace function public.allowance_save(p_id uuid,p_version integer,p_person text,p_date date,p_kind text,p_cents integer,p_memo text) returns void
language plpgsql security invoker set search_path = '' as $$
declare first_month date; today_date date := (now() at time zone 'America/New_York')::date;
begin
  if auth.uid() is null then raise exception 'Login required'; end if;
  select start_month into first_month from public.allowance_settings where owner_id = auth.uid();
  if first_month is null or p_date is null or p_date < first_month or p_date > today_date then raise exception 'Date outside allowed range'; end if;
  if p_version = 0 then
    insert into public.allowance_entries(id,person,entry_date,kind,cents,memo) values(p_id,p_person,p_date,p_kind,p_cents,p_memo) on conflict(id) do nothing;
  else
    update public.allowance_entries set person=p_person,entry_date=p_date,kind=p_kind,cents=p_cents,memo=p_memo,version=version+1 where id=p_id and owner_id=auth.uid() and version=p_version;
    if not found then raise exception 'CONFLICT: record changed. Reload and retry.'; end if;
  end if;
end; $$;
create or replace function public.allowance_delete(p_id uuid,p_version integer) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Login required'; end if;
  delete from public.allowance_entries where id=p_id and owner_id=auth.uid() and version=p_version;
  if not found then raise exception 'CONFLICT: record changed. Reload and retry.'; end if;
end; $$;
revoke all on function public.allowance_snapshot(),public.allowance_save(uuid,integer,text,date,text,integer,text),public.allowance_delete(uuid,integer) from public,anon;
grant execute on function public.allowance_snapshot(),public.allowance_save(uuid,integer,text,date,text,integer,text),public.allowance_delete(uuid,integer) to authenticated;
commit;


-- 新規セットアップ時は以下で家計簿も追加します。
-- 既存のお小遣いアプリに追加する家計簿機能。支出記録は削除しません。
begin;
alter table public.allowance_entries drop constraint if exists allowance_entries_kind_check;
alter table public.allowance_entries add constraint allowance_entries_kind_check check (kind in ('expense','refund','expense_refund'));
create table if not exists public.household_categories (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 40),
  kind text not null check (kind in ('expense','income')),
  created_at timestamptz not null default now(),
  unique(owner_id,kind,name), unique(owner_id,id,kind)
);
create table if not exists public.household_entries (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  person text not null check (person in ('Ritsuya','honami','Hayu','家族共通')),
  entry_date date not null,
  kind text not null check (kind in ('expense','income')),
  category_id uuid not null,
  cents integer not null check(cents > 0 and cents <= 100000000),
  memo text not null default '' check(length(memo)<=200),
  payment text not null default '未指定' check(payment in ('未指定','クレジットカード','デビットカード','現金','銀行振込','その他')),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  foreign key(owner_id,category_id,kind) references public.household_categories(owner_id,id,kind)
);
create index if not exists household_entries_owner_date on public.household_entries(owner_id,entry_date);
create table if not exists public.household_budgets (
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  month date not null check(extract(day from month)=1),
  cents integer not null check(cents>=0 and cents<=100000000),
  version integer not null default 1,
  primary key(owner_id,month)
);
alter table public.household_categories enable row level security;
alter table public.household_entries enable row level security;
alter table public.household_budgets enable row level security;
drop policy if exists household_categories_own on public.household_categories;
create policy household_categories_own on public.household_categories for all to authenticated using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
drop policy if exists household_entries_own on public.household_entries;
create policy household_entries_own on public.household_entries for all to authenticated using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
drop policy if exists household_budgets_own on public.household_budgets;
create policy household_budgets_own on public.household_budgets for all to authenticated using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
revoke all on public.household_categories,public.household_entries,public.household_budgets from anon;
grant select,insert on public.household_categories to authenticated;
grant select,insert,update,delete on public.household_entries,public.household_budgets to authenticated;

create or replace function public.household_snapshot() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare base jsonb;
begin
  if auth.uid() is null then raise exception 'Login required'; end if;
  base := public.allowance_snapshot();
  insert into public.household_categories(owner_id,kind,name)
  select auth.uid(), seed.kind, seed.name from (values
    ('expense','食費'),('expense','外食'),('expense','日用品'),('expense','住居'),
    ('expense','水道・光熱'),('expense','通信'),('expense','交通・車'),('expense','教育・保育'),
    ('expense','医療・健康'),('expense','衣服・美容'),('expense','旅行・レジャー'),('expense','サブスク'),('expense','その他'),
    ('income','給与'),('income','賞与'),('income','手当'),('income','その他')
  ) as seed(kind,name) on conflict(owner_id,kind,name) do nothing;
  return base || jsonb_build_object(
    'categories',coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at,c.name) from public.household_categories c where c.owner_id=auth.uid()),'[]'::jsonb),
    'household',coalesce((select jsonb_agg(to_jsonb(e) order by e.entry_date desc,e.created_at desc) from public.household_entries e where e.owner_id=auth.uid()),'[]'::jsonb),
    'budgets',coalesce((select jsonb_agg(to_jsonb(b) order by b.month) from public.household_budgets b where b.owner_id=auth.uid()),'[]'::jsonb)
  );
end; $$;

create or replace function public.household_save(p_id uuid,p_version integer,p_person text,p_date date,p_kind text,p_category uuid,p_cents integer,p_memo text,p_payment text) returns void
language plpgsql security invoker set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'Login required'; end if;
  if p_date is null or p_date<date '2000-01-01' or p_date>(now() at time zone 'America/New_York')::date then raise exception 'Invalid date'; end if;
  if p_version=0 then
    insert into public.household_entries(id,person,entry_date,kind,category_id,cents,memo,payment)
    values(p_id,p_person,p_date,p_kind,p_category,p_cents,p_memo,p_payment)
    on conflict(id) do nothing;
  else
    update public.household_entries set person=p_person,entry_date=p_date,kind=p_kind,category_id=p_category,cents=p_cents,memo=p_memo,payment=p_payment,version=version+1
    where id=p_id and owner_id=auth.uid() and version=p_version;
    if not found then raise exception 'CONFLICT: record changed'; end if;
  end if;
end; $$;
create or replace function public.household_delete(p_id uuid,p_version integer) returns void
language plpgsql security invoker set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'Login required'; end if;
  delete from public.household_entries where id=p_id and owner_id=auth.uid() and version=p_version;
  if not found then raise exception 'CONFLICT: record changed'; end if;
end; $$;
create or replace function public.household_add_category(p_name text,p_kind text) returns uuid
language plpgsql security invoker set search_path='' as $$
declare result uuid;
begin
  if auth.uid() is null then raise exception 'Login required'; end if;
  insert into public.household_categories(name,kind) values(btrim(p_name),p_kind) on conflict(owner_id,kind,name) do nothing;
  select id into result from public.household_categories where owner_id=auth.uid() and name=btrim(p_name) and kind=p_kind;
  return result;
end; $$;
create or replace function public.household_save_budget(p_month date,p_cents integer,p_version integer) returns void
language plpgsql security invoker set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'Login required'; end if;
  if p_version=0 then
    insert into public.household_budgets(month,cents) values(p_month,p_cents) on conflict(owner_id,month) do nothing;
    if not found then raise exception 'CONFLICT: budget changed'; end if;
  else
    update public.household_budgets set cents=p_cents,version=version+1 where owner_id=auth.uid() and month=p_month and version=p_version;
    if not found then raise exception 'CONFLICT: budget changed'; end if;
  end if;
end; $$;
revoke all on function public.household_snapshot(),public.household_save(uuid,integer,text,date,text,uuid,integer,text,text),public.household_delete(uuid,integer),public.household_add_category(text,text),public.household_save_budget(date,integer,integer) from public,anon;
grant execute on function public.household_snapshot(),public.household_save(uuid,integer,text,date,text,uuid,integer,text,text),public.household_delete(uuid,integer),public.household_add_category(text,text),public.household_save_budget(date,integer,integer) to authenticated;
commit;

-- v3: English UI, payment methods and removable categories. Existing records are retained.
begin;
alter table public.household_categories add column if not exists archived boolean not null default false;
create table if not exists public.household_category_setup (
 owner_id uuid primary key default auth.uid() references auth.users(id) on delete cascade
);
alter table public.household_category_setup enable row level security;
drop policy if exists household_category_setup_own on public.household_category_setup;
create policy household_category_setup_own on public.household_category_setup for all to authenticated using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
revoke all on public.household_category_setup from anon;
grant select,insert on public.household_category_setup to authenticated;
grant update(archived) on public.household_categories to authenticated;

alter table public.household_entries drop constraint if exists household_entries_payment_check;
update public.household_entries set payment=case payment
 when '未指定' then 'Not specified' when 'クレジットカード' then 'Credit card' when 'デビットカード' then 'Debit card'
 when '現金' then 'Cash' when '銀行振込' then 'Bank transfer' when 'その他' then 'Other' else payment end;
alter table public.household_entries alter column payment set default 'Not specified';
alter table public.household_entries add constraint household_entries_payment_check check(payment in ('Not specified','Honda','AMEX','Credit card','Debit card','Cash','Bank transfer','Check','Other'));

create or replace function public.household_initialize_categories() returns void
language plpgsql security invoker set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Login required'; end if;
 insert into public.household_category_setup(owner_id) values(auth.uid()) on conflict do nothing;
 if found then
  -- Hide the old built-in choices. Their IDs and historical transactions are retained.
  update public.household_categories set archived=true where owner_id=auth.uid() and name in ('食費','外食','日用品','住居','水道・光熱','通信','交通・車','教育・保育','医療・健康','衣服・美容','旅行・レジャー','サブスク','その他','給与','賞与','手当');
  insert into public.household_categories(owner_id,kind,name)
  select auth.uid(),'expense',name from (values ('Home'),('Essentials'),('Entertainment'),('Social'),('Dining out'),('Car'),('Electricity'),('Gas'),('Water')) as defaults(name)
  on conflict(owner_id,kind,name) do nothing;
 end if;
end; $$;

create or replace function public.household_snapshot() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare base jsonb;
begin
 if auth.uid() is null then raise exception 'Login required'; end if;
 base:=public.allowance_snapshot();
 perform public.household_initialize_categories();
 return base || jsonb_build_object(
  'categories',coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at,c.name) from public.household_categories c where c.owner_id=auth.uid()),'[]'::jsonb),
  'household',coalesce((select jsonb_agg(to_jsonb(e) order by e.entry_date desc,e.created_at desc) from public.household_entries e where e.owner_id=auth.uid()),'[]'::jsonb),
  'budgets',coalesce((select jsonb_agg(to_jsonb(b) order by b.month) from public.household_budgets b where b.owner_id=auth.uid()),'[]'::jsonb)
 );
end; $$;
create or replace function public.household_add_category(p_name text,p_kind text) returns uuid
language plpgsql security invoker set search_path='' as $$
declare result uuid;
begin
 if auth.uid() is null then raise exception 'Login required'; end if;
 perform public.household_initialize_categories();
 insert into public.household_categories(name,kind) values(btrim(p_name),p_kind) on conflict(owner_id,kind,name) do nothing;
 update public.household_categories set archived=false where owner_id=auth.uid() and name=btrim(p_name) and kind=p_kind returning id into result;
 return result;
end; $$;
create or replace function public.household_remove_category(p_id uuid) returns void
language plpgsql security invoker set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Login required'; end if;
 update public.household_categories set archived=true where id=p_id and owner_id=auth.uid();
 if not found then raise exception 'Category not found'; end if;
end; $$;
revoke all on function public.household_initialize_categories(),public.household_remove_category(uuid) from public,anon;
grant execute on function public.household_initialize_categories(),public.household_remove_category(uuid) to authenticated;
-- The other functions retain their authenticated-only permissions from v2.
commit;
