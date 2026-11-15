'use strict';
const $=id=>document.getElementById(id);
const money=n=>new Intl.NumberFormat('tr-TR',{style:'currency',currency:'TRY'}).format(Number(n)||0);
const states={new:'Yeni talep',contacted:'İletişime geçildi',paid:'Ödeme alındı',preparing:'Hazırlanıyor',printing:'3D baskıda',packaging:'Paketleniyor',shipped:'Kargoya verildi',delivered:'Teslim edildi',cancelled:'İptal'};
const payStates={not_paid:'Ödeme yapılmadı',pending:'Ödeme bekleniyor',paid:'Ödendi ✓',failed:'Ödeme başarısız'};
let rows=[],config={enabled:false,shippingFee:0},activeOrder=null,pollTimer=null,submitted=false;
async function api(url,method='GET',body){const r=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,cache:'no-store',credentials:'same-origin'});const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.error||'İstek başarısız.');return data}
function warn(msg){$('checkoutFeedback').textContent=msg}
function node(tag,text,cls){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el}
function render(){const el=$('checkoutProducts');el.replaceChildren();let subtotal=0;
 if(!rows.length){el.append(node('p','Sepetinde ürün bulunmuyor. Müzeden ürün ekleyebilirsin.'));$('checkoutSubmit').disabled=true;}
 else $('checkoutSubmit').disabled=submitted;
 for(const {product:p,quantity:q} of rows){const line=node('div',undefined,'checkout-item');line.append(node('strong',p.name),node('span',q+' × '+money(p.price)),node('strong',money(p.price*q)));el.append(line);subtotal+=p.price*q;}
 $('checkoutSubtotal').textContent=money(subtotal);$('checkoutShipping').textContent=money(config.shippingFee);$('checkoutTotal').textContent=money(subtotal+config.shippingFee);
 $('checkoutSubmit').textContent=config.enabled?'Sipariş oluştur ve güvenli ödemeye geç →':'Sipariş talebi oluştur →';
 $('paymentNotice').textContent=config.enabled?'Ödeme Shopier sitesinde yapılır. ThreeDee kart verisi toplamaz. Siparişin ancak Shopier API üzerinden doğrulandıktan sonra ödendi görünür.':'Shopier bağlantısı henüz etkin değil. Siparişin ödeme yapılmamış talep olarak kaydedilir.';
}
const timeline=['paid','preparing','printing','packaging','shipped','delivered'];
function renderOrders(orders){const el=$('customerOrders');el.replaceChildren();if(!orders.length){el.textContent='Henüz siparişin yok.';return}
 for(const o of orders){const card=node('article',undefined,'checkout-order order-card');const heading=node('div',undefined,'order-card-head');heading.append(node('strong','#'+o.id.slice(0,8)),node('span',new Date(o.created_at).toLocaleString('tr-TR')),node('strong',money(o.total)));card.append(heading);
  card.append(node('div',(states[o.status]||o.status)+' · '+(payStates[o.payment_status]||o.payment_status),'order-status'));
  if(o.payment_status==='paid'){
   const index=timeline.indexOf(o.status);const step=node('div',undefined,'tracking-progress');for(let i=0;i<timeline.length;i++){const dot=node('span',i<=(index<0?0:index)?'●':'○',i<=(index<0?0:index)?'track-done':'');dot.title=states[timeline[i]];step.append(dot)}card.append(step);
   card.append(node('small','Ödendi → Hazırlanıyor → 3D baskı → Paketleme → Kargo → Teslim'));
  }
  if(o.tracking_number){const p=node('p',`Kargo: ${o.carrier||'Kargo firması'} · ${o.tracking_number}`);card.append(p);if(o.tracking_url&&/^https:\/\//i.test(o.tracking_url)){const a=node('a','Kargoyu takip et ↗');a.href=o.tracking_url;a.target='_blank';a.rel='noopener noreferrer';card.append(a)}}
  if(o.payment_status==='failed')card.append(node('small','Ödeme gerçekleşmedi. Sepetindeki ürünlerle yeni bir sipariş deneyebilirsin.'));
  if(o.payment_status==='pending'){
   card.append(node('small','Shopier ödemesi bekleniyor. Ödeme yaptıysan yenileyerek kontrol edebilirsin.'));
   if(config.enabled){const retry=node('button','Shopier ödeme bağlantısını aç ↗','retry-payment');retry.type='button';retry.onclick=async()=>{retry.disabled=true;try{const pay=await api('/api/customer/orders/'+encodeURIComponent(o.id)+'/pay','POST');showPayment(pay.checkoutUrl,o.id)}catch(e){warn(e.message)}finally{retry.disabled=false}};card.append(retry)}
  }
  el.append(card);
 }
}
async function refreshOrders(){const data=await api('/api/customer/orders');renderOrders(data.orders||[]);return data.orders||[]}
function showPayment(url,orderId){const modal=$('paymentArea');const target=new URL(url);
 if(target.protocol!=='https:'||!['www.shopier.com','shopier.com'].includes(target.hostname))throw new Error('Geçersiz Shopier ödeme bağlantısı.');
 modal.hidden=false;const link=$('shopierPayLink');link.href=target.href;link.hidden=false;
 $('paymentStatus').textContent='Shopier bağlantısı hazır. Aşağıdaki butona basarak Shopier sitesinde ödemeni tamamla, ardından buraya dönüp sipariş durumunu yenile.';activeOrder=orderId;
 modal.scrollIntoView({behavior:'smooth',block:'start'});startPoll(orderId);
}
function startPoll(orderId){clearInterval(pollTimer);let ticks=0;pollTimer=setInterval(async()=>{if(document.hidden)return;if(++ticks>35){clearInterval(pollTimer);return}try{const orders=await refreshOrders();const o=orders.find(x=>x.id===orderId);if(!o)return;if(['paid','failed'].includes(o.payment_status)){
 clearInterval(pollTimer);$('paymentStatus').textContent=o.payment_status==='paid'?'Shopier ödemesi doğrulandı. Siparişiniz hazırlanacak.':'Ödeme başarısız oldu. Yeni sipariş oluşturabilirsiniz.';
 $('shopierPayLink').hidden=true;
 if(o.payment_status==='paid'){submitted=true;rows=[];render();}
 }}catch{}},4000)}
$('closePayment').addEventListener('click',()=>{document.getElementById('paymentArea').hidden=true;clearInterval(pollTimer);warn('Shopier ödeme bağlantısını siparişlerinden yeniden açabilirsin.');});
$('refreshOrders').addEventListener('click',async()=>{try{await refreshOrders();warn('Siparişlerin güncellendi.')}catch(e){warn(e.message)}});
$('checkoutForm').addEventListener('submit',async e=>{e.preventDefault();if(!rows.length)return;const btn=$('checkoutSubmit');btn.disabled=true;warn('');
 try{const payload={recipient:$('checkoutName').value,phone:$('checkoutPhone').value,city:$('checkoutCity').value,address:$('checkoutAddress').value,note:$('checkoutNote').value};
  const response=await api('/api/customer/orders','POST',payload);submitted=true;const id=response.order.id;
  if(config.enabled){
   warn('Sipariş oluşturuldu. Shopier bağlantısı hazırlanıyor…');
   try{const pay=await api('/api/customer/orders/'+encodeURIComponent(id)+'/pay','POST');showPayment(pay.checkoutUrl,id);warn('Shopier bağlantısındaki alışverişi tamamla, ardından buradaki durumunu yenile.');}
   catch(err){warn('Sipariş oluşturuldu ancak ödeme açılamadı: '+err.message+' Siparişlerden durumunu kontrol et.');}
  }else{warn('Sipariş talebin kaydedildi: #'+id.slice(0,8)+' · Ödeme alınmadı.');rows=[];render()}
  await refreshOrders();
 }catch(err){warn(err.message)}finally{btn.disabled=submitted;if(rows.length)render()}
});
async function load(){try{
 const session=await api('/api/customer/session');if(!session.authenticated){warn('Sipariş için hesabına giriş yap.');setTimeout(()=>location.href='/?login=1',1500);return}
 const [list,c,orders,paymentConfig]=await Promise.all([api('/api/products'),api('/api/customer/cart'),api('/api/customer/orders'),api('/api/payment/config')]);
 config=paymentConfig;rows=c.items.map(item=>({product:list.find(p=>p.id===item.id),quantity:item.quantity})).filter(x=>x.product);render();renderOrders(orders.orders||[]);
 const params=new URLSearchParams(location.search);if(params.get('payment')){
  const id=params.get('order');const selected=(orders.orders||[]).find(x=>x.id===id);
  if(selected){warn(selected.payment_status==='paid'?'Ödeme doğrulandı. Siparişini aşağıdan takip edebilirsin.':selected.payment_status==='failed'?'Ödeme başarısız oldu. Siparişini kontrol et.':'Shopier ödeme doğrulaması bekleniyor. Shopier üzerinden ödeme yaptıysan Yenile butonuna bas.');if(selected.payment_status==='pending')startPoll(selected.id)}
 }
 }catch(e){warn(e.message)}}
load();
