// Deno / Supabase Edge Function. Cron invokes it with x-welldose-job-secret.
// Never deploy private VAPID keys, job secrets or service-role keys to Netlify.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { buildPushPayload } from 'npm:@block65/webcrypto-web-push@2.0.0';

type Subscription = {id:string;user_id:string;endpoint:string;p256dh:string;auth_secret:string};
type Reminder = {id:string;startAt:string;repeatDays:number;enabled:boolean};
const WINDOW_MS=5*60_000; // A short tolerance for scheduler delay; never backfill days of missed alarms.

function isReminder(value:unknown):value is Reminder {
  if(!value||typeof value!=='object')return false;
  const r=value as Record<string,unknown>;
  return typeof r.id==='string'&&/^[a-f0-9-]{36}$/i.test(r.id)&&typeof r.startAt==='string'
    && Number.isFinite(Date.parse(r.startAt))&&[0,1,7,14,28].includes(Number(r.repeatDays))&&r.enabled!==false;
}
function dueAt(reminder:Reminder,now:number):number|null {
  const first=Date.parse(reminder.startAt);
  if(!Number.isFinite(first)||first>now)return null;
  const interval=reminder.repeatDays*86_400_000;
  const at=interval?first+Math.floor((now-first)/interval)*interval:first;
  return now-at<=WINDOW_MS?at:null;
}
function response(status:number,result:unknown):Response {
  return new Response(JSON.stringify(result),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
}
function allowedPushService(endpoint:string):boolean {
  try{
    const uri=new URL(endpoint),host=uri.hostname.toLowerCase();
    if(uri.protocol!=='https:'||uri.port||uri.username||uri.password)return false;
    return host==='fcm.googleapis.com'||host==='updates.push.services.mozilla.com'
      ||host.endsWith('.push.apple.com')||host.endsWith('.notify.windows.com');
  }catch{return false;}
}

Deno.serve(async req=>{
  if(req.method!=='POST')return response(405,{error:'POST required'});
  const expected=Deno.env.get('WELLDOSE_PUSH_JOB_SECRET');
  if(!expected||req.headers.get('x-welldose-job-secret')!==expected)return response(401,{error:'Unauthorized'});
  const url=Deno.env.get('SUPABASE_URL');
  const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ||
    JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}').default;
  const vapid={subject:Deno.env.get('WELLDOSE_VAPID_SUBJECT')||'',
    publicKey:Deno.env.get('WELLDOSE_VAPID_PUBLIC_KEY')||'',privateKey:Deno.env.get('WELLDOSE_VAPID_PRIVATE_KEY')||''};
  if(!url||!key||!vapid.subject||!vapid.publicKey||!vapid.privateKey)
    return response(503,{error:'Required server secrets are missing'});
  const admin=createClient(url,key,{auth:{autoRefreshToken:false,persistSession:false}});
  const now=Date.now();
  const subs:Subscription[]=[];
  for(let offset=0;offset<10000;offset+=500){
    const {data,error}=await admin.from('push_subscriptions').select('id,user_id,endpoint,p256dh,auth_secret')
      .order('id').range(offset,offset+499);
    if(error)return response(500,{error:'Subscription lookup failed'});
    subs.push(...(data||[]));
    if((data||[]).length<500)break;
  }
  const byUser=new Map<string,Subscription[]>();
  for(const item of subs){const current=byUser.get(item.user_id)||[];current.push(item);byUser.set(item.user_id,current);}
  const users=Array.from(byUser.keys());
  let examined=0,sent=0,failed=0;
  for(let index=0;index<users.length;index+=100){
    const {data:records,error}=await admin.from('journal_records').select('user_id,payload')
      .in('user_id',users.slice(index,index+100));
    if(error)return response(500,{error:'Reminder lookup failed'});
    for(const record of records||[]){
      const reminders=Array.isArray(record.payload?.reminders)?record.payload.reminders:[];
      for(const reminder of reminders.filter(isReminder)){
        const occurs=dueAt(reminder,now);
        if(occurs===null)continue;
        for(const sub of byUser.get(record.user_id)||[]){
          examined++;
          if(!allowedPushService(sub.endpoint)){failed++;continue;}
          const entry={user_id:record.user_id,reminder_id:reminder.id,subscription_id:sub.id,
            scheduled_at:new Date(occurs).toISOString()};
          const {data:claimed,error:claimError}=await admin.from('push_deliveries').upsert(entry,{
            onConflict:'user_id,reminder_id,scheduled_at,subscription_id',ignoreDuplicates:true,
          }).select('id');
          if(claimError){failed++;continue;}
          if(!claimed?.length)continue; // Already sent by another invocation.
          try{
            // Do not put drug names, doses or medical details on the lock screen.
            const payload=await buildPushPayload({data:JSON.stringify({tag:'welldose-'+reminder.id}),
              options:{ttl:300}}, {endpoint:sub.endpoint,expirationTime:null,
              keys:{p256dh:sub.p256dh,auth:sub.auth_secret}},vapid);
            const pushResponse=await fetch(sub.endpoint,payload);
            if(pushResponse.ok){
              await admin.from('push_deliveries').update({delivered_at:new Date().toISOString()}).eq('id',claimed[0].id);
              sent++;
            }else{
              failed++;
              if(pushResponse.status===404||pushResponse.status===410){
                await admin.from('push_subscriptions').delete().eq('id',sub.id);
              }else{
                await admin.from('push_deliveries').delete().eq('id',claimed[0].id);
              }
            }
          }catch{
            failed++;
            await admin.from('push_deliveries').delete().eq('id',claimed[0].id);
          }
        }
      }
    }
  }
  return response(200,{ok:true,subscriptions:subs.length,examined,sent,failed});
});
