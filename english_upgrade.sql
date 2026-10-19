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
