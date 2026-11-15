'use strict';
// ThreeDee V8 Shopier adapter: hosted Shopier product checkout and server-side paid-order reconciliation.
// NOTE: creating a Shopier product is NOT payment confirmation. Never trust the browser's return URL.
const crypto=require('node:crypto');
const commerce=require('./customer-v6.js');
const PAT=String(process.env.SHOPIER_PAT||'').trim();
const LIVE_READY=process.env.SHOPIER_LIVE_READY==='1';
const configured=Boolean(PAT && LIVE_READY && commerce.enabled);
const base='https://api.shopier.com/v1';
const site=String(process.env.PUBLIC_SITE_URL||'https://threed-urun-muzesi.onrender.com').replace(/\/+$/,'');
const shippingFee=Math.max(0,Math.min(10000,Number(process.env.THREEDEE_SHIPPING_FEE_TRY)||0));
const issue=(message,status=400)=>Object.assign(new Error(message),{status});
const esc=encodeURIComponent;
const cents=n=>Math.round(Number(n)*100);
const lastCheck=new Map();
const pendingStart=new Set();
function config(){return {enabled:configured,provider:configured?'shopier':null,testMode:null,shippingFee,shopUrl:'https://www.shopier.com/threedee'};}
function publicOrder(o){return {id:o.id,items:o.items,total:o.total,status:o.status,payment_status:o.payment_status,created_at:o.created_at,carrier:o.carrier||'',tracking_number:o.tracking_number||'',tracking_url:o.tracking_url||'',paid_at:o.paid_at||null,status_updated_at:o.status_updated_at||null,shipping_fee:o.shipping_fee||0};}
async function getOrder(id){const r=await commerce.supa(commerce.db('museum_orders',`?id=eq.${esc(id)}&select=*&limit=1`));return r[0]||null;}
async function api(path,{method='GET',body}={}){
 if(!PAT)throw issue('Shopier anahtarı bulunamadı.',503);
 let response,payload;try{
   response=await fetch(base+path,{method,headers:{Authorization:'Bearer '+PAT,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(18000)});
   payload=await response.json();
 }catch{throw issue('Shopier API bağlantısı kurulamadı; ödeme durumunu daha sonra tekrar kontrol et.',502)}
 if(!response.ok)throw issue(`Shopier API isteği başarısız (${response.status}). Mağaza API izinlerini kontrol et.`,502);
 return payload;
}
function productPayload(order){
 if(!order||!Array.isArray(order.items)||!order.items.length)throw issue('Sipariş sepeti boş.');
 const amount=cents(order.total);
 if(!Number.isSafeInteger(amount)||amount<100||amount>100000000)throw issue('Sipariş tutarı geçersiz.');
 const photo=String(process.env.SHOPIER_IMAGE_URL||site+'/threedee-banner.jpg');
 if(!/^https:\/\/[A-Za-z0-9._/-]+\.(png|jpg|jpeg)(?:\?[^\s]*)?$/i.test(photo))throw issue('SHOPIER_IMAGE_URL geçerli HTTPS JPG/PNG adresi olmalı.',503);
 const list=order.items.map(p=>`${Number(p.quantity)} × ${String(p.name).slice(0,70)}`).join(' | ');
 return {
  title:'ThreeDee özel sipariş #'+order.id.slice(0,8).toUpperCase(),
  description:('ThreeDee 3D Müze siparişi: '+list+' | Referans: '+order.id).slice(0,900),
  type:'physical',media:[{type:'image',url:photo,placement:1}],
  priceData:{currency:'TRY',price:(amount/100).toFixed(2)},stockQuantity:1,
  shippingPayer:'sellerPays',customListing:true,dispatchDuration:5
 };
}
function checkoutUrl(url){
 const u=new URL(url);
 if(u.protocol!=='https:'||!['www.shopier.com','shopier.com'].includes(u.hostname)||!u.pathname.startsWith('/'))throw issue('Shopier geçersiz ürün bağlantısı döndürdü.',502);
 return u.href;
}
async function start(user,orderId){
 if(!configured)throw issue('Shopier entegrasyonu henüz etkin değil. Sipariş talebi oluşturabilirsin.',503);
 if(!/^[0-9a-f-]{36}$/i.test(orderId))throw issue('Sipariş bulunamadı.',404);
 const order=await getOrder(orderId);
 if(!order||order.user_id!==user.id)throw issue('Sipariş bulunamadı.',404);
 if(order.payment_status==='paid')throw issue('Bu sipariş zaten ödenmiş.',409);
 if(order.payment_status==='pending'&&order.shopier_product_id){
  try{await reconcileOne(order)}catch(e){console.warn('Ödeme tekrar açılmadan önce Shopier kontrolü:',e.message)}
  const current=await getOrder(orderId);
  if(current?.payment_status==='paid')throw issue('Bu siparişin ödemesi zaten doğrulandı; yeniden ödeme yapma.',409);
 }
 if(order.payment_status!=='pending'||order.status==='cancelled')throw issue('Bu sipariş için ödeme başlatılamaz.',409);
 if(order.payment_provider && order.payment_provider!=='shopier')throw issue('Bu sipariş farklı ödeme kuruluşuyla açılmış. Yeni sipariş oluştur.',409);
 if(order.shopier_checkout_url && order.shopier_product_id)return {orderId,checkoutUrl:checkoutUrl(order.shopier_checkout_url)};
 const payload=productPayload(order); // Validate BEFORE reserving the pending payment reference.
 if(pendingStart.has(orderId))throw issue('Ödeme bağlantısı oluşturuluyor. Biraz sonra tekrar dene.',409);
 pendingStart.add(orderId);
 try{
  // The reservation limits duplicate product creation across simultaneous clicks on different instances.
  const reservation='shopier-pending-'+crypto.randomUUID();
  const changed=await commerce.supa(commerce.db('museum_orders',`?id=eq.${esc(orderId)}&payment_status=eq.pending&payment_ref=is.null`),{method:'PATCH',body:{payment_provider:'shopier',payment_ref:reservation,payment_amount_cents:cents(order.total),payment_started_at:new Date().toISOString(),payment_test:false},extra:{Prefer:'return=representation'}});
  if(!Array.isArray(changed)||changed.length!==1){
    const fresh=await getOrder(orderId);
    if(fresh?.shopier_checkout_url&&fresh.shopier_product_id)return {orderId,checkoutUrl:checkoutUrl(fresh.shopier_checkout_url)};
    throw issue('Ödeme bağlantısı oluşturuluyor veya önceki deneme tamamlanamadı. Yöneticiyle iletişime geç.',409);
  }
  const product=await api('/products',{method:'POST',body:payload});
  const id=String(product?.id||'');if(!/^[0-9A-Za-z_-]{1,80}$/.test(id))throw issue('Shopier ürün kimliği doğrulanamadı.',502);
  const url=checkoutUrl(product.url);
  const saved=await commerce.supa(commerce.db('museum_orders',`?id=eq.${esc(orderId)}&payment_ref=eq.${esc(reservation)}&payment_status=eq.pending`),{method:'PATCH',body:{shopier_product_id:id,shopier_checkout_url:url,payment_ref:'shopier-'+id},extra:{Prefer:'return=representation'}});
  if(!Array.isArray(saved)||saved.length!==1)throw issue('Shopier bağlantısı oluşturuldu ancak sipariş kaydı güncellenemedi. Yöneticiyle iletişime geç.',502);
  return {orderId,checkoutUrl:url};
 }finally{pendingStart.delete(orderId)}
}
function verifyPaid(shopierOrder,localOrder){
 const wanted=String(localOrder.shopier_product_id||'');
 if(!wanted||shopierOrder?.paymentStatus!=='paid'||shopierOrder?.currency!=='TRY'||!shopierOrder?.id)return false;
 const total=cents(shopierOrder?.totals?.total);
 if(!Number.isSafeInteger(total)||total!==cents(localOrder.total))return false;
 const items=shopierOrder.lineItems;
 if(!Array.isArray(items)||items.length!==1)return false;
 const item=items[0];
 const got=String(item?.productId||item?.product?.id||item?.product?.productId||'');
 const qty=Number(item?.quantity??item?.count??1);
 return got===wanted&&qty===1;
}
async function reconcileOne(order){
 if(!configured||order.payment_status!=='pending'||order.payment_provider!=='shopier'||!order.shopier_product_id)return;
 const key=String(order.id),now=Date.now();if((lastCheck.get(key)||0)>now-15000)return;
 lastCheck.set(key,now);if(lastCheck.size>500)lastCheck.clear();
 // A PAT-authenticated read from Shopier is the source of truth. There is no browser-driven paid endpoint.
 const response=await api('/orders?'+new URLSearchParams({productId:String(order.shopier_product_id),limit:'20'}));
 const records=Array.isArray(response)?response:Array.isArray(response?.items)?response.items:Array.isArray(response?.data)?response.data:[];
 const paid=records.find(row=>verifyPaid(row,order));if(!paid)return;
 const changed=await commerce.supa(commerce.db('museum_orders',`?id=eq.${esc(order.id)}&payment_status=eq.pending&payment_provider=eq.shopier&shopier_product_id=eq.${esc(order.shopier_product_id)}`),{method:'PATCH',body:{payment_status:'paid',status:'paid',shopier_order_id:String(paid.id),paid_at:new Date().toISOString(),status_updated_at:new Date().toISOString(),payment_charge_cents:cents(paid.totals.total)},extra:{Prefer:'return=representation'}});
 if(Array.isArray(changed)&&changed.length===1){
  try{const cart=await commerce.cart(order.user_id);for(const p of order.items){const c=cart.find(x=>x.id===p.productId);if(c&&c.quantity===p.quantity)await commerce.setCart(order.user_id,p.productId,0)}}catch(e){console.warn('Ödeme sonrası sepet temizlenemedi:',e.message)}
 }
}
async function reconcile(userId){
 if(!configured)return;
 const rows=await commerce.supa(commerce.db('museum_orders',`?user_id=eq.${esc(userId)}&payment_status=eq.pending&payment_provider=eq.shopier&select=*&order=created_at.desc&limit=8`));
 for(const order of rows){try{await reconcileOne(order)}catch(e){console.warn('Shopier ödeme sorgusu:',e.message)}}
}
async function reconcileAdmin(){
 if(!configured)return;
 const rows=await commerce.supa(commerce.db('museum_orders','?payment_status=eq.pending&payment_provider=eq.shopier&select=*&order=created_at.desc&limit=12'));
 for(const order of rows){try{await reconcileOne(order)}catch(e){console.warn('Shopier yönetici ödeme sorgusu:',e.message)}}
}
module.exports={config,start,reconcile,reconcileAdmin,productPayload,verifyPaid,publicOrder,shippingFee};
