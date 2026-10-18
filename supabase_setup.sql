-- プードル貯金と同じプロジェクトにも追加可能。既存テーブルは変更しません。
begin;
create table if not exists public.allowance_settings (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  start_month date not null default date_trunc('month', now() at time zone 'America/New_York')::date,
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
alter table public.allowance_settings enable row level security;
alter table public.allowance_entries enable row level security;
drop policy if exists allowance_settings_own on public.allowance_settings;
create policy allowance_settings_own on public.allowance_settings for select to authenticated using (owner_id = (select auth.uid()));
drop policy if exists allowance_settings_create on public.allowance_settings;
create policy allowance_settings_create on public.allowance_settings for insert to authenticated with check (owner_id = (select auth.uid()) and start_month = date_trunc('month',now() at time zone 'America/New_York')::date);
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
