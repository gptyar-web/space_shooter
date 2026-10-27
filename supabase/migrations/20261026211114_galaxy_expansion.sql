-- Additive Space Shooter expansion. All writes are authenticated in the Edge API;
-- transactional routines are invoker-only and executable solely by service_role.
alter table public.ss_packages add column autopilot text not null default 'none' check(autopilot in ('none','go','plus','pro'));
alter table public.ss_packages add column auto_shield boolean not null default false;
alter table public.ss_purchases add column features jsonb not null default '{}'::jsonb;
alter table public.ss_runs add column loadout jsonb not null default '{}'::jsonb;
alter table public.ss_runs add column boss_defeated boolean not null default false;
alter table public.ss_runs add column outcome jsonb;
alter table public.ss_runs add column resources jsonb not null default '{}'::jsonb;
create table public.ss_package_grants (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.ss_profiles(id) on delete cascade,
 package_id uuid not null references public.ss_packages(id),granted_by uuid references public.ss_profiles(id),
 features jsonb not null,created_at timestamptz not null default now(),unique(user_id,package_id)
);
create index ss_grants_admin on public.ss_package_grants(granted_by);
create index ss_grants_package on public.ss_package_grants(package_id);
create table public.ss_inventory (
 user_id uuid primary key references public.ss_profiles(id) on delete cascade,
 iron int not null default 0 check(iron>=0),crystal int not null default 0 check(crystal>=0),energy int not null default 0 check(energy>=0),
 weapon_level int not null default 0 check(weapon_level between 0 and 5),hull_level int not null default 0 check(hull_level between 0 and 5),
 drones text[] not null default '{}',equipped_drones text[] not null default '{}',
 check(drones <@ array['gun','shield','collector']::text[]),check(equipped_drones <@ drones)
);
create table public.ss_friend_requests (
 id uuid primary key default gen_random_uuid(),sender_id uuid not null references public.ss_profiles(id) on delete cascade,
 recipient_id uuid not null references public.ss_profiles(id) on delete cascade,
 status text not null default 'pending' check(status in ('pending','accepted','declined')),
 created_at timestamptz not null default now(),responded_at timestamptz,check(sender_id<>recipient_id)
);
create unique index ss_pending_friend_pair on public.ss_friend_requests(least(sender_id,recipient_id),greatest(sender_id,recipient_id)) where status='pending';
create index ss_friend_recipient_time on public.ss_friend_requests(recipient_id,created_at desc);
create index ss_friend_sender_time on public.ss_friend_requests(sender_id,created_at desc);
create table public.ss_friendships (
 user_a uuid not null references public.ss_profiles(id) on delete cascade,user_b uuid not null references public.ss_profiles(id) on delete cascade,
 created_at timestamptz not null default now(),primary key(user_a,user_b),check(user_a<user_b)
);
create index ss_friendships_b on public.ss_friendships(user_b);
create table public.ss_presence (
 user_id uuid primary key references public.ss_profiles(id) on delete cascade,last_seen timestamptz not null default now(),online boolean not null default true
);
create table public.ss_coop_rooms (
 id uuid primary key default gen_random_uuid(),host_id uuid not null references public.ss_profiles(id) on delete cascade,
 guest_id uuid not null references public.ss_profiles(id) on delete cascade,stage int not null check(stage between 1 and 200),
 status text not null default 'pending' check(status in ('pending','active','declined','cancelled','completed')),
 host_run uuid references public.ss_runs(id),guest_run uuid references public.ss_runs(id),
 host_loadout jsonb,guest_loadout jsonb,seed int not null default floor(random()*2147483646)::int,
 created_at timestamptz not null default now(),started_at timestamptz,expires_at timestamptz not null default now()+interval '90 seconds',
 result jsonb,check(host_id<>guest_id)
);
create index ss_coop_host_status on public.ss_coop_rooms(host_id,status,created_at desc);
create index ss_coop_guest_status on public.ss_coop_rooms(guest_id,status,created_at desc);
create index ss_coop_host_run on public.ss_coop_rooms(host_run);create index ss_coop_guest_run on public.ss_coop_rooms(guest_run);
create index ss_ticket_owner_updated on public.ss_tickets(user_id,updated_at desc);

create or replace function ss_private.is_ss_admin() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.ss_admins a join public.ss_profiles p on p.id=a.id where a.id=auth.uid() and p.active)
$$;
revoke all on function ss_private.is_ss_admin() from public,anon;grant usage on schema ss_private to authenticated;
grant execute on function ss_private.is_ss_admin() to authenticated;
create policy ss_admin_read_packages on public.ss_packages for select to authenticated using((select ss_private.is_ss_admin()));
create policy ss_admin_read_tickets on public.ss_tickets for select to authenticated using((select ss_private.is_ss_admin()));
create policy ss_admin_read_messages on public.ss_ticket_messages for select to authenticated using((select ss_private.is_ss_admin()));
create policy ss_admin_read_notices on public.ss_announcements for select to authenticated using((select ss_private.is_ss_admin()));
alter table public.ss_package_grants enable row level security;alter table public.ss_inventory enable row level security;
alter table public.ss_friend_requests enable row level security;alter table public.ss_friendships enable row level security;
alter table public.ss_presence enable row level security;alter table public.ss_coop_rooms enable row level security;
create policy ss_own_grants on public.ss_package_grants for select to authenticated using(user_id=(select auth.uid()));
create policy ss_own_inventory on public.ss_inventory for select to authenticated using(user_id=(select auth.uid()));
create policy ss_own_friend_requests on public.ss_friend_requests for select to authenticated using(sender_id=(select auth.uid()) or recipient_id=(select auth.uid()));
create policy ss_own_friendships on public.ss_friendships for select to authenticated using(user_a=(select auth.uid()) or user_b=(select auth.uid()));
create policy ss_friends_presence on public.ss_presence for select to authenticated using(user_id=(select auth.uid()) or exists(select 1 from public.ss_friendships f where (f.user_a=(select auth.uid()) and f.user_b=user_id) or(f.user_b=(select auth.uid()) and f.user_a=user_id)));
create policy ss_own_rooms on public.ss_coop_rooms for select to authenticated using(host_id=(select auth.uid()) or guest_id=(select auth.uid()));
grant select on public.ss_package_grants,public.ss_inventory,public.ss_friend_requests,public.ss_friendships,public.ss_presence,public.ss_coop_rooms to authenticated;
grant all on public.ss_package_grants,public.ss_inventory,public.ss_friend_requests,public.ss_friendships,public.ss_presence,public.ss_coop_rooms to service_role;

-- ON CONFLICT still checks an INSERT's CHECK constraints before reaching UPDATE.
-- The old routine inserted a negative balance for every debit, rejecting all spending.
create or replace function public.ss_post_ledger(p_user uuid,p_delta bigint,p_reason text,p_ref text)
returns bigint language plpgsql security definer set search_path='' as $$
declare entry_id bigint;new_balance bigint;begin
 if p_delta=0 or length(p_ref)<3 then raise exception 'Invalid ledger entry';end if;
 insert into public.ss_wallets(user_id,balance) values(p_user,0) on conflict(user_id) do nothing;
 insert into public.ss_ledger(user_id,delta,reason,ref) values(p_user,p_delta,p_reason,p_ref)
 on conflict(ref) do nothing returning id into entry_id;
 if entry_id is null then return null;end if;
 update public.ss_wallets set balance=balance+p_delta where user_id=p_user and balance+p_delta>=0 returning balance into new_balance;
 if not found then raise exception 'موجودی سکه کافی نیست';end if;
 return entry_id;end $$;
revoke all on function public.ss_post_ledger(uuid,bigint,text,text) from public,anon,authenticated;
grant execute on function public.ss_post_ledger(uuid,bigint,text,text) to service_role;

-- Admin subscriptions are still authorized server-side, including changes to other wallets.
create policy ss_admin_read_wallets on public.ss_wallets for select to authenticated using((select ss_private.is_ss_admin()));
create policy ss_admin_read_profiles on public.ss_profiles for select to authenticated using((select ss_private.is_ss_admin()));
create policy ss_admin_read_orders on public.ss_orders for select to authenticated using((select ss_private.is_ss_admin()));
create policy ss_admin_read_ledger on public.ss_ledger for select to authenticated using((select ss_private.is_ss_admin()));
-- A deactivated catalogue row is no longer SELECT-visible to players, so invalidate
-- through a public settings row as well; this handles removal without unsafe broad RLS.
create function public.ss_catalog_changed() returns trigger language plpgsql set search_path='' as $$begin update public.ss_settings set updated_at=now() where id=true;return null;end $$;
revoke all on function public.ss_catalog_changed() from public,anon,authenticated;grant execute on function public.ss_catalog_changed() to service_role;
create trigger ss_package_catalog_changed after insert or update or delete on public.ss_packages for each statement execute function public.ss_catalog_changed();
create trigger ss_notice_catalog_changed after insert or update or delete on public.ss_announcements for each statement execute function public.ss_catalog_changed();

-- Features are snapshotted at purchase/grant, so later edits cannot remove paid access.
update public.ss_purchases q set features=jsonb_build_object('autopilot',p.autopilot,'auto_shield',p.auto_shield) from public.ss_packages p where p.id=q.package_id;
create or replace function ss_private.ss_loadout(p_user uuid) returns jsonb language sql stable set search_path='' as $$
 with features as (select features from public.ss_purchases where user_id=p_user union all select features from public.ss_package_grants where user_id=p_user),
 rights as(select coalesce(max(case features->>'autopilot' when 'pro' then 3 when 'plus' then 2 when 'go' then 1 else 0 end),0) as tier,coalesce(bool_or((features->>'auto_shield')::boolean),false) as shield from features)
 select jsonb_build_object('protocol','galaxy-v1','autopilot',(array['none','go','plus','pro'])[r.tier+1],'auto_shield',r.shield,
 'drones',coalesce(i.equipped_drones,'{}'::text[]),'weapon_level',coalesce(i.weapon_level,0),'hull_level',coalesce(i.hull_level,0))
 from rights r left join public.ss_inventory i on i.user_id=p_user
$$;
revoke all on function ss_private.ss_loadout(uuid) from public,anon,authenticated;grant execute on function ss_private.ss_loadout(uuid) to service_role;
create or replace function public.ss_game_loadout(p_user uuid) returns jsonb language sql set search_path='' as $$select ss_private.ss_loadout(p_user)$$;
create or replace function public.ss_buy_package(p_user uuid,p_package uuid) returns bigint language plpgsql set search_path='' as $$
 declare item public.ss_packages%rowtype; purchase_id uuid:=gen_random_uuid();begin
 perform 1 from public.ss_profiles where id=p_user for update;
 select * into item from public.ss_packages where id=p_package and active for share;
 if not found then raise exception 'بسته در دسترس نیست';end if;
 if item.autopilot<>'none' or item.auto_shield then
  if exists(select 1 from public.ss_purchases where user_id=p_user and package_id=p_package) or exists(select 1 from public.ss_package_grants where user_id=p_user and package_id=p_package) then raise exception 'این بسته را قبلاً دریافت کرده‌اید';end if;
 end if;
 perform public.ss_post_ledger(p_user,-item.coins,'package','package:'||purchase_id);
 insert into public.ss_purchases(id,user_id,package_id,price,features) values(purchase_id,p_user,p_package,item.coins,jsonb_build_object('autopilot',item.autopilot,'auto_shield',item.auto_shield));return item.coins;
 end $$;
create function public.ss_grant_package(p_admin uuid,p_package uuid,p_username text,p_all boolean default false) returns int language plpgsql set search_path='' as $$
 declare n int;item public.ss_packages%rowtype;begin
 if not exists(select 1 from public.ss_admins where id=p_admin) then raise exception 'دسترسی مدیریت لازم است';end if;
 select * into item from public.ss_packages where id=p_package;if not found then raise exception 'بسته یافت نشد';end if;
 insert into public.ss_package_grants(user_id,package_id,granted_by,features)
 select id,item.id,p_admin,jsonb_build_object('autopilot',item.autopilot,'auto_shield',item.auto_shield) from public.ss_profiles where active and(p_all or username=p_username)
 on conflict(user_id,package_id) do nothing;get diagnostics n=row_count;
 if n=0 and not p_all and not exists(select 1 from public.ss_profiles where username=p_username and active) then raise exception 'کاربر فعال یافت نشد';end if;
 return n;end $$;
create function public.ss_hangar(p_user uuid,p_action text,p_item text,p_equipped text[] default '{}') returns jsonb language plpgsql set search_path='' as $$
 declare v public.ss_inventory%rowtype;cost int;level int;iron_cost int;crystal_cost int;energy_cost int;begin
 insert into public.ss_inventory(user_id) values(p_user) on conflict do nothing;
 select * into v from public.ss_inventory where user_id=p_user for update;
 if p_action='buyDrone' then
  cost:=case p_item when 'gun' then 650 when 'shield' then 800 when 'collector' then 500 else null end;
  if cost is null or p_item=any(v.drones) then raise exception 'پهپاد نامعتبر یا قبلاً خریداری شده است';end if;
  perform public.ss_post_ledger(p_user,-cost,'drone','drone:'||p_user||':'||p_item);
  update public.ss_inventory set drones=array_append(drones,p_item),equipped_drones=array_append(equipped_drones,p_item) where user_id=p_user;
 elsif p_action='equipDrones' then
  if cardinality(p_equipped)>3 or not p_equipped<@v.drones or cardinality(p_equipped)<>(select count(distinct x) from unnest(p_equipped) x) then raise exception 'تجهیز پهپاد نامعتبر است';end if;
  update public.ss_inventory set equipped_drones=p_equipped where user_id=p_user;
 elsif p_action='craft' then
  if p_item not in ('weapon','hull') then raise exception 'قطعه نامعتبر است';end if;
  level:=case p_item when 'weapon' then v.weapon_level else v.hull_level end;
  if level>=5 then raise exception 'قطعه در بالاترین سطح است';end if;
  iron_cost:=10*(level+1);crystal_cost:=5*(level+1);energy_cost:=3*(level+1);
  if v.iron<iron_cost or v.crystal<crystal_cost or v.energy<energy_cost then raise exception 'منابع کافی نیست';end if;
  update public.ss_inventory set iron=iron-iron_cost,crystal=crystal-crystal_cost,energy=energy-energy_cost,
  weapon_level=weapon_level+case when p_item='weapon' then 1 else 0 end,hull_level=hull_level+case when p_item='hull' then 1 else 0 end where user_id=p_user;
 else raise exception 'عملیات آشیانه نامعتبر است';end if;
 select * into v from public.ss_inventory where user_id=p_user;return to_jsonb(v);end $$;
create function public.ss_request_friend(p_user uuid,p_username text) returns uuid language plpgsql set search_path='' as $$
 declare other_id uuid;request_id uuid;begin
 select id into other_id from public.ss_profiles where username=p_username and active;
 if other_id is null or other_id=p_user then raise exception 'نام کاربری دوست نامعتبر است';end if;
 perform 1 from public.ss_profiles where id in(p_user,other_id) order by id for update;
 if (select count(*) from public.ss_friendships where user_a=p_user or user_b=p_user)>=200 then raise exception 'سقف دوستان شما پر شده است';end if;
 if exists(select 1 from public.ss_friendships where user_a=least(p_user,other_id) and user_b=greatest(p_user,other_id)) then raise exception 'این کاربر در دوستان شماست';end if;
 if exists(select 1 from public.ss_friend_requests where least(sender_id,recipient_id)=least(p_user,other_id) and greatest(sender_id,recipient_id)=greatest(p_user,other_id) and status='pending') then raise exception 'درخواست در انتظار پاسخ است';end if;
 if (select count(*) from public.ss_friend_requests where sender_id=p_user and created_at>now()-interval '1 hour')>=20 then raise exception 'سقف درخواست‌های ساعتی پر شده است';end if;
 insert into public.ss_friend_requests(sender_id,recipient_id) values(p_user,other_id) returning id into request_id;return request_id;end $$;
create function public.ss_answer_friend(p_user uuid,p_request uuid,p_accept boolean) returns boolean language plpgsql set search_path='' as $$
 declare r public.ss_friend_requests%rowtype;begin
 select * into r from public.ss_friend_requests where id=p_request and recipient_id=p_user for update;
 if not found or r.status<>'pending' then raise exception 'درخواست در انتظار پاسخ یافت نشد';end if;
 update public.ss_friend_requests set status=case when p_accept then 'accepted' else 'declined' end,responded_at=now() where id=r.id;
 if p_accept then insert into public.ss_friendships(user_a,user_b) values(least(r.sender_id,p_user),greatest(r.sender_id,p_user)) on conflict do nothing;end if;
 return p_accept;end $$;
create function public.ss_invite_coop(p_user uuid,p_friend uuid,p_stage int) returns uuid language plpgsql set search_path='' as $$
 declare room_id uuid;begin
 perform 1 from public.ss_profiles where id in(p_user,p_friend) order by id for update;
 if not exists(select 1 from public.ss_friendships where user_a=least(p_user,p_friend) and user_b=greatest(p_user,p_friend)) then raise exception 'ابتدا درخواست دوستی باید تأیید شود';end if;
 if p_stage<1 or p_stage>200 or p_stage is null then raise exception 'مرحله نامعتبر است';end if;
 if (select count(*) from public.ss_presence where user_id in(p_user,p_friend) and online and last_seen>now()-interval '45 seconds')<>2 then raise exception 'هر دو بازیکن باید آنلاین باشند';end if;
 if p_stage>1 and(select count(*) from public.ss_progress where user_id in(p_user,p_friend) and stage=p_stage-1 and cleared and best_score>=75)<>2 then raise exception 'این مرحله باید برای هر دو بازیکن باز باشد';end if;
 update public.ss_coop_rooms set status='cancelled' where (host_id in(p_user,p_friend) or guest_id in(p_user,p_friend)) and ((status='pending' and expires_at<now())or(status='active' and started_at<now()-interval '30 minutes'));
 if exists(select 1 from public.ss_coop_rooms where status in('pending','active') and(host_id in(p_user,p_friend) or guest_id in(p_user,p_friend))) then raise exception 'یکی از بازیکنان دعوت یا نبرد فعال دارد';end if;
 insert into public.ss_coop_rooms(host_id,guest_id,stage) values(p_user,p_friend,p_stage) returning id into room_id;return room_id;end $$;
create function public.ss_answer_coop(p_user uuid,p_room uuid,p_accept boolean) returns jsonb language plpgsql set search_path='' as $$
 declare r public.ss_coop_rooms%rowtype;hr uuid;gr uuid;hl jsonb;gl jsonb;begin
 select * into r from public.ss_coop_rooms where id=p_room and guest_id=p_user for update;
 if not found or r.status<>'pending' then raise exception 'دعوت معتبر یافت نشد';end if;
 if not p_accept then update public.ss_coop_rooms set status='declined' where id=r.id;return jsonb_build_object('accepted',false);end if;
 if r.expires_at<now() then raise exception 'زمان دعوت تمام شده است';end if;
 if (select count(*) from public.ss_presence pr join public.ss_profiles p on p.id=pr.user_id where pr.user_id in(r.host_id,r.guest_id) and pr.online and pr.last_seen>now()-interval '45 seconds' and p.active)<>2 then raise exception 'هر دو بازیکن باید آنلاین باشند';end if;
 if r.stage>1 and(select count(*) from public.ss_progress where user_id in(r.host_id,r.guest_id) and stage=r.stage-1 and cleared and best_score>=75)<>2 then raise exception 'مرحله برای هر دو بازیکن باز نیست';end if;
 hl:=ss_private.ss_loadout(r.host_id);gl:=ss_private.ss_loadout(r.guest_id);
 insert into public.ss_runs(user_id,stage,loadout) values(r.host_id,r.stage,hl) returning id into hr;
 insert into public.ss_runs(user_id,stage,loadout) values(r.guest_id,r.stage,gl) returning id into gr;
 update public.ss_coop_rooms set status='active',started_at=now(),host_run=hr,guest_run=gr,host_loadout=hl,guest_loadout=gl where id=r.id returning * into r;
 return to_jsonb(r);end $$;
create function public.ss_finish_galaxy(p_user uuid,p_run uuid,p_kills int,p_score int,p_won boolean,p_hearts int,p_elapsed double precision,p_boss boolean,p_resources jsonb,p_coins int) returns jsonb language plpgsql set search_path='' as $$
 declare r public.ss_runs%rowtype;result record;v_outcome jsonb;v_awarded jsonb;bonus int:=0;material text;v int;boss_bonus int:=0;begin
 select * into r from public.ss_runs where id=p_run and user_id=p_user for update;
 if not found then raise exception 'نبرد نامعتبر است';end if;
 if r.outcome is not null then return r.outcome;end if;
 if r.finished_at is not null or coalesce(r.loadout->>'protocol','')<>'galaxy-v1' then raise exception 'نبرد نامعتبر یا قبلاً ثبت شده است';end if;
 if p_won and r.stage%10=0 and p_boss is not true then raise exception 'باس فصل هنوز شکست نخورده است';end if;
 if p_coins is null or p_coins<0 or p_coins>8+least(12,r.stage/10) then raise exception 'سکه‌های نبرد نامعتبر است';end if;
 if p_resources is null or jsonb_typeof(p_resources)<>'object' then raise exception 'منابع نامعتبر است';end if;
 foreach material in array array['iron','crystal','energy'] loop
  if coalesce(p_resources->>material,'') !~ '^[0-9]{1,3}$' then raise exception 'منابع نامعتبر است';end if;
  v:=(p_resources->>material)::int;
  if v>3*(8+least(12,r.stage/10)) then raise exception 'منابع بیش از سقف نبرد است';end if;
 end loop;
 select * into result from public.ss_finish_verified_run(p_user,p_run,p_kills,p_score,p_won,p_hearts,p_elapsed);
 v_awarded:=case when p_won then p_resources else '{}'::jsonb end;
 if p_won then
  insert into public.ss_inventory(user_id) values(p_user) on conflict do nothing;
  if result.reward>0 then
   bonus:=p_coins*2;
   if r.stage%10=0 then boss_bonus:=250+(r.stage/10)*100;bonus:=bonus+boss_bonus;end if;
   if bonus>0 then perform public.ss_post_ledger(p_user,bonus,'mission_bonus','mission-bonus:'||p_user||':'||r.stage);end if;
  end if;
  if boss_bonus>0 then v_awarded:=jsonb_set(v_awarded,'{crystal}',to_jsonb((p_resources->>'crystal')::int+4+r.stage/10));end if;
  update public.ss_inventory set iron=iron+(v_awarded->>'iron')::int,crystal=crystal+(v_awarded->>'crystal')::int,energy=energy+(v_awarded->>'energy')::int where user_id=p_user;
 end if;
 v_outcome:=jsonb_build_object('reward',result.reward+bonus,'score',result.score,'unlocked',result.unlocked,'boss_bonus',boss_bonus,'resources',v_awarded);
 update public.ss_runs set boss_defeated=coalesce(p_boss,false),resources=v_awarded,outcome=v_outcome where id=p_run;
 return v_outcome;end $$;
create function public.ss_finish_coop(p_user uuid,p_room uuid,p_result jsonb) returns jsonb language plpgsql set search_path='' as $$
 declare r public.ss_coop_rooms%rowtype;host_result jsonb;guest_result jsonb;begin
 select * into r from public.ss_coop_rooms where id=p_room and host_id=p_user for update;
 if not found then raise exception 'فقط میزبان مجاز به ثبت نتیجه است';end if;
 if r.status='completed' then return r.result;end if;
 if r.status<>'active' then raise exception 'نبرد فعال نیست';end if;
 if (select count(*) from public.ss_presence where user_id in(r.host_id,r.guest_id) and online and last_seen>now()-interval '45 seconds')<>2 then raise exception 'ارتباط هر دو بازیکن برای ثبت نتیجه لازم است';end if;
 host_result:=public.ss_finish_galaxy(r.host_id,r.host_run,(p_result->>'kills')::int,(p_result->>'score')::int,(p_result->>'won')::boolean,(p_result->>'hearts')::int,(p_result->>'elapsed')::float8,(p_result->>'boss_defeated')::boolean,p_result->'resources',(p_result->>'coins')::int);
 guest_result:=public.ss_finish_galaxy(r.guest_id,r.guest_run,(p_result->>'kills')::int,(p_result->>'score')::int,(p_result->>'won')::boolean,(p_result->>'hearts')::int,(p_result->>'elapsed')::float8,(p_result->>'boss_defeated')::boolean,p_result->'resources',(p_result->>'coins')::int);
 update public.ss_coop_rooms set status='completed',result=jsonb_build_object('host',host_result,'guest',guest_result,'battle',p_result) where id=r.id returning * into r;return r.result;end $$;
create function public.ss_cancel_coop(p_user uuid,p_room uuid) returns boolean language plpgsql set search_path='' as $$
 declare r public.ss_coop_rooms%rowtype;begin
 select * into r from public.ss_coop_rooms where id=p_room and p_user in(host_id,guest_id) for update;
 if not found then raise exception 'دعوت یافت نشد';end if;
 if r.status not in('pending','active') then return false;end if;
 update public.ss_coop_rooms set status='cancelled' where id=r.id;
 update public.ss_runs set finished_at=now(),won=false,score=0 where id in(r.host_run,r.guest_run) and finished_at is null;return true;end $$;
create function public.ss_support_send(p_user uuid,p_message text) returns uuid language plpgsql set search_path='' as $$
 declare ticket uuid;begin
 if length(trim(p_message))<1 or length(p_message)>4000 then raise exception 'پیام باید بین ۱ تا ۴۰۰۰ نویسه باشد';end if;
 perform pg_advisory_xact_lock(hashtextextended('ss-support:'||p_user,0));
 if (select count(*) from public.ss_ticket_messages where author_id=p_user and created_at>now()-interval '1 minute')>=12 then raise exception 'پیام‌ها را با فاصله ارسال کنید';end if;
 select id into ticket from public.ss_tickets where user_id=p_user and status not in('closed','closed_support') order by updated_at desc limit 1 for update;
 if ticket is null then insert into public.ss_tickets(user_id,subject) values(p_user,'گفت‌وگو با پشتیبانی') returning id into ticket;end if;
 insert into public.ss_ticket_messages(ticket_id,author_id,message) values(ticket,p_user,trim(p_message));
 update public.ss_tickets set status='review',updated_at=now() where id=ticket;return ticket;end $$;

-- Sender-specific private topics prevent the guest from impersonating host snapshots.
create function ss_private.ss_room_access(p_topic text,p_write boolean) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.ss_coop_rooms r join public.ss_profiles p on p.id=auth.uid() and p.active
 where r.status='active' and r.started_at>now()-interval '30 minutes' and auth.uid() in(r.host_id,r.guest_id)
 and p_topic in('ss-room:'||r.id||':'||r.host_id,'ss-room:'||r.id||':'||r.guest_id)
 and(not p_write or p_topic='ss-room:'||r.id||':'||auth.uid()))
$$;
revoke all on function ss_private.ss_room_access(text,boolean) from public,anon;grant execute on function ss_private.ss_room_access(text,boolean) to authenticated;
create policy ss_room_receive on realtime.messages for select to authenticated using(extension='broadcast' and ss_private.ss_room_access((select realtime.topic()),false));
create policy ss_room_send on realtime.messages for insert to authenticated with check(extension='broadcast' and ss_private.ss_room_access((select realtime.topic()),true));
-- No direct browser writes to game state, money, materials, requests or room membership.
do $$ declare fn text;begin
 foreach fn in array array['ss_game_loadout(uuid)','ss_buy_package(uuid,uuid)','ss_grant_package(uuid,uuid,text,boolean)','ss_hangar(uuid,text,text,text[])','ss_request_friend(uuid,text)','ss_answer_friend(uuid,uuid,boolean)','ss_invite_coop(uuid,uuid,integer)','ss_answer_coop(uuid,uuid,boolean)','ss_finish_galaxy(uuid,uuid,integer,integer,boolean,integer,double precision,boolean,jsonb,integer)','ss_finish_coop(uuid,uuid,jsonb)','ss_cancel_coop(uuid,uuid)','ss_support_send(uuid,text)'] loop
 execute 'revoke all on function public.'||fn||' from public,anon,authenticated';execute 'grant execute on function public.'||fn||' to service_role';end loop;end $$;
do $$ declare tbl text;begin foreach tbl in array array['ss_wallets','ss_progress','ss_purchases','ss_packages','ss_package_grants','ss_inventory','ss_friend_requests','ss_friendships','ss_presence','ss_coop_rooms','ss_ticket_messages','ss_tickets','ss_announcements','ss_settings','ss_orders','ss_profiles','ss_ledger','ss_daily_claims'] loop
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=tbl) then execute format('alter publication supabase_realtime add table public.%I',tbl);end if;
 end loop;end $$;
