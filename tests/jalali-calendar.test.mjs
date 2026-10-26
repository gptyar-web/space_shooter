import test from "node:test";
import assert from "node:assert/strict";
import {jalaliToUTC,parseJalaliDate,jalaliToISO,jalaliFromISO,jalaliMonthGrid,shiftJalaliMonth} from "../jalali-calendar.js";

test("Persian date conversion respects Iranian timezone",()=>{
 assert.equal(jalaliToUTC(1405,1,1).toISOString(),"2026-03-21T00:00:00.000Z");
 assert.equal(jalaliToISO("۱۴۰۵/۰۱/۰۱","۰۰:۰۰"),"2026-03-20T20:30:00.000Z");
 assert.equal(jalaliToISO("1405/01/01","23:59",true),"2026-03-21T20:29:59.999Z");
 assert.deepEqual(jalaliFromISO("2026-03-20T20:30:00.000Z"),{date:"1405/01/01",time:"00:00"});
});
test("invalid Jalali dates and times are rejected",()=>{
 assert.ok(parseJalaliDate("1403/12/30"));
 assert.equal(parseJalaliDate("1404/12/30"),null);
 assert.equal(parseJalaliDate("1405/07/31"),null);
 assert.throws(()=>jalaliToISO("1405/01/01","24:00"),/نامعتبر/);
 assert.throws(()=>jalaliToISO("1404/12/30","23:59"),/انتخاب/);
});
test("Calendar has Saturday-first grid and handles year boundaries",()=>{
 const days=jalaliMonthGrid(1405,1);
 assert.equal(days.filter(Boolean).length,31);
 assert.equal(days[0],1); // 1405/01/01 is a Saturday
 assert.deepEqual(shiftJalaliMonth(1405,12,1),{year:1406,month:1});
 assert.deepEqual(shiftJalaliMonth(1405,1,-1),{year:1404,month:12});
 assert.ok(jalaliMonthGrid(1599,12).length>=28);
});
