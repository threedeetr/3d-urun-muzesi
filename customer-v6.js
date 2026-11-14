'use strict';
// ThreeDee V6: Supabase Auth + private carts/favorites/order requests + lightweight live presence.
// No browser access to the Supabase secret key. No card payments handled.
const crypto=require('node:crypto');
const URL=String(process.env.SUPABASE_URL||'').replace(/\/+$/,'');
const SECRET=process.env.SUPABASE_SECRET_KEY||'';
const enabled=Boolean(URL&&SECRET);
const appSecret=process.env.CUSTOMER_SESSION_SECRET||process.env.ADMIN_PASSWORD||crypto.randomBytes(32).toString('hex');
const key=crypto.createHash('sha256').update('threedee-v6-customer-session|'+appSecret).digest();
const hmacKey=crypto.createHash('sha256').update('threedee-v6-visitor|'+appSecret).digest();
const entries=new Map();
const authCache=new Map();
const authAttempts=new Map();
const stamp=()=>Math.floor(Date.now()/1000);
const error=(message,status=400)=>Object.assign(new Error(message),{status});
const encode=encodeURIComponent;
const headers=()=>({apikey:SECRET,...(SECRET.startsWith('eyJ')?{Authorization:'Bearer '+SECRET}:{})});
const nickname=x=>String(x||'').replace(/[<>\x00-\x1f]/g,'').trim().replace(/\s+/g,' ').slice(0,25);
function parseCookie(req,name){const p=String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='));return p?.slice(name.length+1)||'';}
function cookie(req,name,value,seconds){const secure=req.socket.encrypted||req.headers['x-forwarded-proto']==='https'?'; Secure':'';return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${secure}`;}
function setCookie(res,val){const old=res.getHeader('Set-Cookie');res.setHeader('Set-Cookie',old?[...([].concat(old)),val]:val);}
function seal(session){const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);const payload=Buffer.concat([cipher.update(JSON.stringify(session)),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),payload]).toString('base64url');}
function unseal(input){try{const bytes=Buffer.from(input,'base64url');if(bytes.length<29||bytes.length>5000)return null;const dec=crypto.createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));dec.setAuthTag(bytes.subarray(12,28));return JSON.parse(Buffer.concat([dec.update(bytes.subarray(28)),dec.final()]).toString());}catch{return null;}}
function writeSession(req,res,s){setCookie(res,cookie(req,'threedee_customer',seal(s),30*86400));}
function clearSession(req,res){setCookie(res,cookie(req,'threedee_customer','',0));}
async function supa(endpoint,{method='GET',body,extra={}}={}){
 if(!enabled)throw error('Müşteri hesapları için Supabase bağlantısı gerekiyor.',503);
 const res=await fetch(URL+endpoint,{method,headers:{...headers(),...(body!==undefined?{'Content-Type':'application/json'}:{}),...extra},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
 const raw=await res.text();let data;try{data=raw?JSON.parse(raw):null}catch{data={message:raw}}
 if(!res.ok){const msg=String(data?.msg||data?.error_description||data?.message||data?.error||'Sunucu isteği başarısız.').slice(0,200);throw error(res.status===429?'Çok fazla deneme. Bir süre sonra tekrar dene.':msg,res.status===401?401:res.status===429?429:res.status===400||res.status===422?400:502)}
 return data;
}
function toStored(s){return {access:s.access_token,refresh:s.refresh_token,expiry:stamp()+(s.expires_in||3600)-5,user:{id:s.user?.id,email:s.user?.email,nickname:nickname(s.user?.user_metadata?.nickname||s.user?.email?.split('@')[0]||'Ziyaretçi')}};}
async function findUser(req,res){
 let stored=unseal(parseCookie(req,'threedee_customer'));if(!stored)return null;
 try{
  if(stored.expiry<stamp()+60){const renewed=await supa('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:stored.refresh}});stored=toStored(renewed);writeSession(req,res,stored)}
  const cached=authCache.get(stored.access);
  if(!cached||cached.until<Date.now()){
    const user=await supa('/auth/v1/user',{extra:{Authorization:'Bearer '+stored.access}});
    stored.user={id:user.id,email:user.email,nickname:nickname(user.user_metadata?.nickname||user.email?.split('@')[0]||'Ziyaretçi')};
    authCache.set(stored.access,{until:Date.now()+30000,user:stored.user});
    if(authCache.size>2000)authCache.clear();
  }else stored.user=cached.user;
  return stored.user;
 }catch(e){if(e.status===401||e.status===400){clearSession(req,res);return null}throw e;}
}
function getPublicIdentity(req){const stored=unseal(parseCookie(req,'threedee_customer'));return stored&&stored.expiry>stamp()&&stored.user?.id?stored.user:null;}
async function requireUser(req,res){const user=await findUser(req,res);if(!user)throw error('Devam etmek için hesabına giriş yap.',401);return user;}
function authLimit(req){const ip=String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',')[0];const now=Date.now();const a=authAttempts.get(ip)||[];const list=a.filter(t=>now-t<15*60_000);if(list.length>=15)throw error('Çok sayıda giriş denemesi. Daha sonra tekrar dene.',429);list.push(now);authAttempts.set(ip,list);if(authAttempts.size>4000)authAttempts.clear();}
async function authCall(req,res,type,body){authLimit(req);const email=String(body.email||'').trim().toLowerCase(),password=String(body.password||'');if(!/^\S+@\S+\.\S+$/.test(email)||email.length>150||password.length<8||password.length>128)throw error('Geçerli e-posta ve en az 8 karakterli şifre gir.');
 if(type==='register'){
   const name=nickname(body.nickname);
   if(name.length<2)throw error('Adın en az 2 karakter olmalı.');
   const result=await supa('/auth/v1/signup',{method:'POST',body:{email,password,data:{nickname:name}}});
   if(result.access_token){writeSession(req,res,toStored(result));return {ok:true,verificationRequired:false,user:{email,nickname:name}}}
   return {ok:true,verificationRequired:true,message:'E-postana gelen doğrulama bağlantısını aç, sonra giriş yap.'};
 }
 const result=await supa('/auth/v1/token?grant_type=password',{method:'POST',body:{email,password}});
 if(!result.access_token||!result.refresh_token)throw error('Giriş tamamlanamadı.',401);
 const session=toStored(result);writeSession(req,res,session);return {ok:true,user:session.user};
}
function db(table,query=''){return `/rest/v1/${table}${query}`;}
async function favorites(userId){const rows=await supa(db('museum_favorites',`?select=product_id&user_id=eq.${encode(userId)}&limit=500`));return rows.map(r=>r.product_id);}
async function favorite(userId,id,on){if(on)await supa(db('museum_favorites','?on_conflict=user_id,product_id'),{method:'POST',body:{user_id:userId,product_id:id},extra:{Prefer:'resolution=merge-duplicates,return=minimal'}});else await supa(db('museum_favorites',`?user_id=eq.${encode(userId)}&product_id=eq.${encode(id)}`),{method:'DELETE'});}
async function cart(userId){const rows=await supa(db('museum_cart',`?select=product_id,quantity&user_id=eq.${encode(userId)}&limit=500`));return rows.map(r=>({id:r.product_id,quantity:r.quantity}));}
async function setCart(userId,id,qty){if(qty<=0){await supa(db('museum_cart',`?user_id=eq.${encode(userId)}&product_id=eq.${encode(id)}`),{method:'DELETE'});return}
 await supa(db('museum_cart','?on_conflict=user_id,product_id'),{method:'POST',body:{user_id:userId,product_id:id,quantity:qty},extra:{Prefer:'resolution=merge-duplicates,return=minimal'}});
}
async function makeOrder(userId,details,products){
 const rows=await cart(userId);if(!rows.length)throw error('Sepetin boş.');if(rows.length>30)throw error('Sepette fazla ürün var.');
 const items=rows.map(row=>{const p=products.find(p=>p.id===row.id&&p.active&&!p.isDemo);if(!p||p.stock<row.quantity)throw error('Sepetindeki bir ürün stokta yok veya artık satılmıyor.');return {productId:p.id,name:p.name,price:Number(p.price),quantity:row.quantity,photo:p.photos?.[0]||null};});
 const recipient=String(details.recipient||'').trim().slice(0,80),city=String(details.city||'').trim().slice(0,80),address=String(details.address||'').trim().slice(0,300),phone=String(details.phone||'').replace(/[^0-9+]/g,'').slice(0,17),note=String(details.note||'').trim().slice(0,450);
 if(recipient.length<3||city.length<2||address.length<10||!/^\+?[0-9]{10,15}$/.test(phone))throw error('Ad-soyad, şehir, telefon ve açık adresi kontrol et.');
 const total=Math.round(items.reduce((a,p)=>a+p.price*p.quantity,0)*100)/100;
 // Guard against accidental double-submission within five minutes.
 const cutoff=encode(new Date(Date.now()-300_000).toISOString());
 const existing=await supa(db('museum_orders',`?select=id,items&user_id=eq.${encode(userId)}&created_at=gte.${cutoff}&order=created_at.desc&limit=5`));
 if(existing.some(row=>JSON.stringify(row.items)===JSON.stringify(items)))throw error('Bu sipariş talebi zaten kaydedilmiş. Geçmiş taleplerini kontrol et.',409);
 const order={id:crypto.randomUUID(),user_id:userId,items,total,status:'new',payment_status:'not_paid',recipient,city,address,phone,note};
 await supa(db('museum_orders'),{method:'POST',body:order,extra:{Prefer:'return=minimal'}});
 // Clear only the user's cart, only after the order request is saved.
 for(const row of rows){try{await setCart(userId,row.id,0)}catch(e){console.error('Order saved, cart cleanup failed:',e.message)}}
 return {id:order.id,total,status:order.status,payment:'not_paid'};
}
async function orders(userId){return supa(db('museum_orders',`?select=id,items,total,status,payment_status,created_at&user_id=eq.${encode(userId)}&order=created_at.desc&limit=50`));}
async function adminOrders(){return supa(db('museum_orders','?select=*&order=created_at.desc&limit=100'));}
async function updateOrder(id,status){if(!['new','contacted','cancelled'].includes(status))throw error('Geçersiz durum.');await supa(db('museum_orders',`?id=eq.${encode(id)}`),{method:'PATCH',body:{status},extra:{Prefer:'return=minimal'}});}
function visitorId(req,res){const value=parseCookie(req,'threedee_visitor');const [id,sig]=value.split('.');if(/^[0-9a-f-]{36}$/.test(id||'')){const correct=crypto.createHmac('sha256',hmacKey).update(id).digest('hex').slice(0,24);if(sig===correct)return id;}
 const created=crypto.randomUUID(),signature=crypto.createHmac('sha256',hmacKey).update(created).digest('hex').slice(0,24);setCookie(res,cookie(req,'threedee_visitor',created+'.'+signature,86400*30));return created;
}
function allVisitors(me){const now=Date.now();for(const [id,v] of entries)if(now-v.time>16000)entries.delete(id);return {count:entries.size,visitors:[...entries.values()].filter(x=>x.id!==me).slice(0,32).map(({id,name,x,z,yaw,color})=>({id,name,x,z,yaw,color}))};}
function presence(req,res,pos){const id=visitorId(req,res);if(pos){const x=Number(pos.x),z=Number(pos.z),yaw=Number(pos.yaw);if(![x,z,yaw].every(Number.isFinite))throw error('Konum hatalı.');
 const member=getPublicIdentity(req);const name=member?nickname(member.nickname):'Misafir '+parseInt(id.replace(/\D/g,'').slice(0,5)||'1',10)%1000;
 const palette=['#e4b789','#92ccd3','#b4a8f0','#d88ca3','#9ad69b','#f1d68c'];const color=palette[parseInt(id.replace(/-/g,'').slice(0,5),16)%palette.length];
 entries.set(id,{id,name,x:Math.max(-12,Math.min(12,x)),z:Math.max(-200,Math.min(21,z)),yaw,color,time:Date.now()});if(entries.size>150){const k=entries.keys().next().value;entries.delete(k)}
 }
 return allVisitors(id);
}
module.exports={enabled,authCall,findUser,requireUser,clearSession,getPublicIdentity,authLimit,favorites,favorite,cart,setCart,makeOrder,orders,adminOrders,updateOrder,presence,error};
