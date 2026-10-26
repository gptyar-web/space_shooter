-- Preserve legitimate pre-upgrade Bale links only when both pieces of
-- historical proof exist: a consumed web-generated code and a Bale session
-- that already progressed past the personal-contact matching stage.
with historic as (
 select s.user_id,min(s.chat_id) as bale_id,max(l.consumed_at) as linked_at
 from public.ss_bale_sessions s
 join public.ss_link_codes l on l.user_id=s.user_id and l.consumed_at is not null
 where s.user_id is not null and s.state in ('need_coins','need_discount','invoice')
 group by s.user_id
 having count(distinct s.chat_id)=1
), safe as (
 select h.* from historic h
 where not exists (
  select 1 from public.ss_profiles other
  where other.bale_user_id=h.bale_id and other.id<>h.user_id
 )
)
update public.ss_profiles p
set bale_user_id=safe.bale_id,bale_verified_at=coalesce(safe.linked_at,now())
from safe
where p.id=safe.user_id and p.bale_user_id is null;
