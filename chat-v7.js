'use strict';
// ThreeDee V7 public museum chat. Supabase PostgREST, privileged server requests ONLY.
// Public can read. Posting requires a verified V6 customer session.
const URL = String(process.env.SUPABASE_URL||'').replace(/\/+$/,'');
const SECRET = process.env.SUPABASE_SECRET_KEY||'';
const enabled = Boolean(URL && SECRET);
const pending = new Set();
const userHits = new Map();
let lastCleanup = 0;
const fail = (message,status=400)=>Object.assign(new Error(message),{status});
const enc = encodeURIComponent;
function canonical(value){
  return String(value).normalize('NFKD').toLocaleLowerCase('tr-TR')
   .replace(/[ıİ]/g,'i').replace(/\p{M}/gu,'')
   .replace(/[0]/g,'o').replace(/[1!]/g,'i').replace(/[3]/g,'e').replace(/[4@]/g,'a')
   .replace(/[5$]/g,'s').replace(/[7]/g,'t').replace(/(.)\1{2,}/gu,'$1')
   .replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
}
// Whole-word patterns prevent rejecting innocent words such as "müzik" or "götür".
const blocked = /\b(?:amk|amq|aq|oc|oç|orospu\w*|siktir\w*|sik(?:er|eyim|icem|mek|im|in|tir|ti|ti[rn]|ik|is|me|sin|sem|sen|ildi|ilir|iliyor|ebilirim)?|yarrak\w*|yarak\w*|pezevenk\w*|pic\w*|ibne\w*|kahpe\w*|puşt\w*|serefsiz\w*|gerizekali\w*|surtuk\w*|got(?:un|une|unu|um|umu|e|te|ten|ten|veren|cul|culuk)?|fuck\w*|bitch\w*)\b/u;
// Handle punctuation-separated obvious insults, without joining unrelated normal words.
const spelled = /(?:^|\s)(?:a[.\s_-]*m[.\s_-]*k|o[.\s_-]*c|s[.\s_-]*i[.\s_-]*k[.\s_-]*t[.\s_-]*i[.\s_-]*r)(?=\s|$)/u;
function validateMessage(input){
 if(typeof input!=='string')throw fail('Mesaj yazmalısın.');
 const body=input.normalize('NFKC').replace(/[\u200B-\u200D\u2060\uFEFF]/g,'').trim().replace(/\s+/g,' ');
 if(body.length<2||body.length>240)throw fail('Mesaj 2–240 karakter olmalı.');
 if(/https?:\/\/|www\.|(?:t\.me|discord\.gg|bit\.ly)\//i.test(body)||/(?:[\w.-]+)@(?:[\w.-]+)\.[a-z]{2,}/i.test(body))throw fail('Sohbette bağlantı ve e-posta adresi paylaşılamaz.');
 if(/(.)\1{11,}/u.test(body))throw fail('Tekrarlanan karakterlerden oluşan mesajlara izin verilmiyor.');
 if((body.match(/[!?.]/g)||[]).length>16)throw fail('Çok fazla noktalama işareti kullanma.');
 const norm=canonical(body);
 if(blocked.test(norm)||spelled.test(norm))throw fail('Uygunsuz ifade nedeniyle mesaj gönderilemedi.');
 return {body,norm};
}
async function request(endpoint,{method='GET',body,prefer}={}){
 if(!enabled)throw fail('Canlı sohbet için Supabase kurulumu gerekiyor.',503);
 const r=await fetch(URL+endpoint,{method,headers:{apikey:SECRET,...(SECRET.startsWith('eyJ')?{Authorization:`Bearer ${SECRET}`}:{}) ,...(body===undefined?{}:{'Content-Type':'application/json'}),...(prefer?{Prefer:prefer}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(12000)});
 const content=await r.text();let data;try{data=content?JSON.parse(content):null}catch{data=null}
 if(!r.ok){console.error('ThreeDee chat database:',r.status,typeof data?.message==='string'?data.message.slice(0,150):'');throw fail('Sohbet veritabanına ulaşılamadı. Supabase SQL kurulumunu kontrol et.',503)}
 return data;
}
function db(table,filter=''){return `/rest/v1/${table}${filter}`}
function selected(row){return {id:row.id,nickname:row.nickname,body:row.body,createdAt:row.created_at}}
async function cleanup(){
 if(Date.now()-lastCleanup<3600_000)return;
 lastCleanup=Date.now();
 const before=new Date(Date.now()-7*86400_000).toISOString();
 request(db('museum_chat_messages',`?created_at=lt.${enc(before)}`),{method:'DELETE'}).catch(e=>console.warn('Chat temizleme:',e.message));
}
async function list(after){
 if(!enabled)throw fail('Önce Supabase bağlantısını tamamla.',503);
 cleanup();
 let filter='?select=id,nickname,body,created_at';
 // Limit cursor to the recent window, even if a client supplies an old timestamp.
 let since=Date.now()-86400_000;
 if(typeof after==='string'&&after.length<=40){const t=Date.parse(after);if(Number.isFinite(t)&&t<=Date.now()+5000)since=Math.max(since,t)}
 filter+=`&created_at=gte.${enc(new Date(since).toISOString())}&order=created_at.desc&limit=60`;
 const rows=await request(db('museum_chat_messages',filter));
 return {messages:rows.reverse().map(selected),serverTime:new Date().toISOString()};
}
function checkBurst(userId){
 const now=Date.now();
 for(const [id,v] of userHits){if(now-v.last>600_000)userHits.delete(id)}
 const state=userHits.get(userId)||{last:0,times:[]};state.times=state.times.filter(x=>now-x<600_000);
 if(now-state.last<1000||state.times.filter(x=>now-x<60_000).length>=16||state.times.length>=65)throw fail('Çok hızlı mesaj gönderiliyor. Biraz sonra tekrar dene.',429);
 state.times.push(now);state.last=now;userHits.set(userId,state);
 if(pending.has(userId))throw fail('Önce önceki mesajın tamamlanmasını bekle.',429);
 pending.add(userId);
}
async function muted(userId){
 const rows=await request(db('museum_chat_mutes',`?select=muted_until&user_id=eq.${enc(userId)}&limit=1`));
 return rows.length?Date.parse(rows[0].muted_until)>Date.now():false;
}
async function send(user,req,payload){
 if(!user||!user.id)throw fail('Mesaj göndermek için giriş yap.',401);
 const {body,norm}=validateMessage(payload?.message);
 checkBurst(user.id);
 try{
  if(await muted(user.id))throw fail('Sohbet hesabın geçici olarak susturuldu.',403);
  // Server-side persisted limits work even after Render restarts / on multiple instances.
  const cutoff=new Date(Date.now()-600_000).toISOString();
  const recent=await request(db('museum_chat_messages',`?select=body,created_at&user_id=eq.${enc(user.id)}&created_at=gte.${enc(cutoff)}&order=created_at.desc&limit=35`));
  const now=Date.now();
  if(recent.length){
   const last=Date.parse(recent[0].created_at);
   if(now-last<6000)throw fail('Mesajlar arasında en az 6 saniye beklemelisin.',429);
   if(recent.filter(x=>now-Date.parse(x.created_at)<60_000).length>=6)throw fail('Bir dakikadaki mesaj sınırına ulaştın.',429);
   if(recent.length>=25)throw fail('10 dakikadaki mesaj sınırına ulaştın.',429);
   if(recent.some(x=>now-Date.parse(x.created_at)<300_000&&canonical(x.body)===norm))throw fail('Aynı mesajı tekrar gönderemezsin.',429);
  }
  const rawName=String(user.nickname||'Ziyaretçi').replace(/[<>\x00-\x1f]/g,'').trim().slice(0,25)||'Ziyaretçi';
  const nickname=blocked.test(canonical(rawName))?'Ziyaretçi':rawName;
  const posted=await request(db('museum_chat_messages'),{method:'POST',body:{user_id:user.id,nickname,body},prefer:'return=representation'});
  return {ok:true,message:selected(posted[0])};
 }finally{pending.delete(user.id)}
}
async function adminList(){const rows=await request(db('museum_chat_messages','?select=id,user_id,nickname,body,created_at&order=created_at.desc&limit=80'));return {messages:rows.map(r=>({...selected(r),userId:r.user_id}))}}
async function adminDelete(id){if(!/^[a-f0-9-]{36}$/.test(id))throw fail('Mesaj kimliği geçersiz.');await request(db('museum_chat_messages',`?id=eq.${enc(id)}`),{method:'DELETE'});return {ok:true}}
async function adminMute(userId,hours=24){if(!/^[a-f0-9-]{36}$/.test(userId))throw fail('Kullanıcı kimliği geçersiz.');const end=new Date(Date.now()+Math.min(168,Math.max(1,Number(hours)||24))*3600_000).toISOString();await request(db('museum_chat_mutes','?on_conflict=user_id'),{method:'POST',body:{user_id:userId,muted_until:end},prefer:'resolution=merge-duplicates,return=minimal'});return {ok:true,mutedUntil:end}}
module.exports={enabled,validateMessage,list,send,adminList,adminDelete,adminMute};
