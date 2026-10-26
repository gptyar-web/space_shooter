// Jalali calendar helpers, using the browser's built-in Persian calendar.
// Date boundaries are stored in UTC; displayed/entered times are Tehran local time.
const persianPartsFormatter=new Intl.DateTimeFormat("en-US-u-ca-persian",{timeZone:"UTC",year:"numeric",month:"numeric",day:"numeric"});
const tehranPartsFormatter=new Intl.DateTimeFormat("en-US-u-ca-persian",{timeZone:"Asia/Tehran",year:"numeric",month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
export const jalaliMonths=["فروردین","اردیبهشت","خرداد","تیر","مرداد","شهریور","مهر","آبان","آذر","دی","بهمن","اسفند"];
function normalizeDigits(s){return String(s??"").replace(/[۰-۹]/g,c=>String("۰۱۲۳۴۵۶۷۸۹".indexOf(c))).replace(/[٠-٩]/g,c=>String("٠١٢٣٤٥٦٧٨٩".indexOf(c)));}

function pickPart(parts,name){return Number(parts.find(x=>x.type===name)?.value);}

export function jalaliToUTC(year,month,day){
 if(!Number.isInteger(year)||year<1300||year>1600||!Number.isInteger(month)||month<1||month>12||!Number.isInteger(day)||day<1||day>31)throw Error("تاریخ شمسی نامعتبر است.");
 const start=Date.UTC(year+621,0,1);
 for(let offset=0;offset<455;offset++){
  const d=new Date(start+offset*86400000),parts=persianPartsFormatter.formatToParts(d);
  if(pickPart(parts,"year")===year&&pickPart(parts,"month")===month&&pickPart(parts,"day")===day)return d;
 }
 throw Error("روز انتخاب‌شده در تقویم شمسی وجود ندارد.");
}

export function parseJalaliDate(text){
 const match=/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(normalizeDigits(text).trim());
 if(!match)return null;
 const [year,month,day]=match.slice(1).map(Number);
 try{jalaliToUTC(year,month,day);return {year,month,day};}catch{return null;}
}

export function formatJalaliDate(year,month,day){return [String(year),String(month).padStart(2,"0"),String(day).padStart(2,"0")].join("/");}

export function jalaliFromISO(value){
 if(!value)return {date:"",time:""};
 const d=new Date(value);if(!Number.isFinite(d.getTime()))throw Error("زمان اعتبار نامعتبر است.");
 const parts=tehranPartsFormatter.formatToParts(d),get=name=>String(pickPart(parts,name)).padStart(2,"0");
 return {date:formatJalaliDate(pickPart(parts,"year"),pickPart(parts,"month"),pickPart(parts,"day")),time:get("hour")+":"+get("minute")};
}

export function jalaliToISO(date,time,includeLastMinute=false){
 const p=parseJalaliDate(date),t=/^(\d{1,2}):(\d{2})$/.exec(normalizeDigits(time).trim());
 if(!p||!t)throw Error("تاریخ یا ساعت معتبر انتخاب کنید.");
 const hour=Number(t[1]),minute=Number(t[2]);if(hour>23||minute>59)throw Error("ساعت انتخاب‌شده نامعتبر است.");
 // Tehran uses UTC+03:30 without seasonal clock changes.
 return new Date(jalaliToUTC(p.year,p.month,p.day).getTime()+(hour*60+minute-210)*60000+(includeLastMinute?59999:0)).toISOString();
}

export function jalaliToday(now=new Date()){
 const parts=tehranPartsFormatter.formatToParts(now);
 return {year:pickPart(parts,"year"),month:pickPart(parts,"month"),day:pickPart(parts,"day")};
}

export function jalaliMonthGrid(year,month){
 const first=jalaliToUTC(year,month,1);
 const next=month===12?jalaliToUTC(year+1,1,1):jalaliToUTC(year,month+1,1);
 const days=Math.round((next-first)/86400000),offset=(first.getUTCDay()+1)%7;
 return [...Array(offset).fill(null),...Array.from({length:days},(_,i)=>i+1)];
}

export function shiftJalaliMonth(year,month,step){const total=year*12+month-1+step;return {year:Math.floor(total/12),month:(total%12+12)%12+1};}
