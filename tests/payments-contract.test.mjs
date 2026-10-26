import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(path)=>readFileSync(path,"utf8");
test("100-percent discount is accepted through UI, API and DB migration",()=>{
 const ui=read("app.js"),server=read("supabase/functions/space-shooter-api/index.ts");
 const sql=read("supabase/009_free_percent_coupon_and_invoice_floor.sql");
 assert.match(ui,/value\.max=kind==="percent"\?"100"/);
 assert.match(server,/kind==="percent"&&value>100/);
 assert.match(sql,/value between 1 and 100/);
 assert.match(sql,/v_discount\.value=100/);
});
test("free coupons are atomic and cannot be redeemed twice on the same account",()=>{
 const sql=read("supabase/009_free_percent_coupon_and_invoice_floor.sql");
 assert.match(sql,/ss_free_coupon_once_per_account/);
 const latest=read("supabase/010_unlimited_free_order_archive.sql");
 assert.doesNotMatch(latest,/if p_coins>500/);
 assert.match(latest,/p_coins>100000/);
 assert.match(sql,/public\.ss_post_ledger\(p_user,p_coins,'free_coupon'/);
 assert.match(sql,/where amount_rial=0 and status='paid'/);
});
test("Bale invoices below the confirmed 10000 IRR floor never reach provider",()=>{
 const sql=read("supabase/009_free_percent_coupon_and_invoice_floor.sql");
 const bot=read("supabase/functions/space-shooter-bale/index.ts");
 assert.match(sql,/v_amount<10000/);
 assert.match(bot,/Number\(order\.amount_rial\)<10000/);
 assert.match(bot,/if\(Number\(order\.amount_rial\)===0\)/);
});
test("startup and admin avoid redundant requests",()=>{
 const source=read("app.js"),server=read("supabase/functions/space-shooter-api/index.ts");
 assert.doesNotMatch(source,/\},500\)/);
 assert.match(source,/setInterval\(updateWallet,30000\)/);
 assert.match(source,/await import\("\.\/game\.js"\)/);
 assert.match(server,/pageQuery\(db\.from\("ss_orders"\)/);
});

test("archived orders retain financial history, reconcile safely and can be restored by an admin",()=>{
 const sql=read("supabase/010_unlimited_free_order_archive.sql");
 const api=read("supabase/functions/space-shooter-api/index.ts");
 const ui=read("app.js");
 assert.match(sql,/ss_order_archive_events/);
 assert.match(sql,/alter table public.ss_order_archive_events enable row level security/);
 assert.match(sql,/ss_admin_archive_order\(/);
 assert.match(sql,/join public.ss_profiles p on p.id=a.id/);
 assert.match(sql,/where id=p_order for update/);
 assert.match(sql,/revoke all on function public.ss_admin_archive_order/);
 assert.doesNotMatch(sql,/delete from public.ss_orders/i);
 assert.match(api,/case "adminArchiveOrder"/);
 assert.match(api,/\.is\("archived_at",null\)/);
 assert.match(api,/\.not\("archived_at","is",null\)/);
 assert.match(ui,/admin-order-archive/);
 assert.match(ui,/admin-order-view/);
 assert.match(ui,/بازگردانی/);
});
