'use strict';
const $=id=>document.getElementById(id);
const money=n=>new Intl.NumberFormat('tr-TR',{style:'currency',currency:'TRY'}).format(Number(n)||0);
let rows=[];
async function api(url,method='GET',body){const r=await fetch(url,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,cache:'no-store'});const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.error||'İstek başarısız.');return data}
function warn(msg){$('checkoutFeedback').textContent=msg}
function node(tag,text,cls){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el}
async function load(){try{
 const session=await api('/api/customer/session');if(!session.authenticated){warn('Sipariş adımı için hesabına giriş yap.');setTimeout(()=>location.href='/?login=1',1500);return}
 const [list,c,orders]=await Promise.all([api('/api/products'),api('/api/customer/cart'),api('/api/customer/orders')]);
 rows=c.items.map(item=>({product:list.find(p=>p.id===item.id),quantity:item.quantity})).filter(x=>x.product);
 render();renderOrders(orders.orders||[]);
 }catch(e){warn(e.message)}}
function render(){const el=$('checkoutProducts');el.replaceChildren();let total=0;
 if(!rows.length){el.append(node('p','Sepetinde ürün bulunmuyor. Müzeden ürün ekleyebilirsin.'));$('checkoutSubmit').disabled=true;}
 for(const {product:p,quantity:q} of rows){const line=node('div',undefined,'checkout-item'),title=node('strong',p.name),count=node('span',q+' × '+money(p.price)),sum=node('strong',money(p.price*q));line.append(title,count,sum);el.append(line);total+=p.price*q;}
 $('checkoutTotal').textContent=money(total)
}
function renderOrders(rows){const el=$('customerOrders');el.replaceChildren();if(!rows.length){el.textContent='Henüz sipariş talebin yok.';return}
 for(const o of rows){const card=node('div',undefined,'checkout-order');const date=new Date(o.created_at).toLocaleString('tr-TR');card.append(node('strong','#'+o.id.slice(0,8)),node('span',date),node('span',money(o.total)),node('b',o.status==='cancelled'?'İptal':o.status==='contacted'?'İletişime geçildi':'İşlem bekliyor'),node('small','Ödeme yapılmadı'));el.append(card)}
}
$('checkoutForm').addEventListener('submit',async e=>{e.preventDefault();if(!rows.length)return;const btn=$('checkoutSubmit');btn.disabled=true;warn('');
 try{const payload={recipient:$('checkoutName').value,phone:$('checkoutPhone').value,city:$('checkoutCity').value,address:$('checkoutAddress').value,note:$('checkoutNote').value};
 const response=await api('/api/customer/orders','POST',payload);
 warn('Sipariş talebin kaydedildi: #'+response.order.id.slice(0,8)+' · Ödeme alınmadı. Yönetici iletişime geçebilir.');
 const ord=await api('/api/customer/orders');renderOrders(ord.orders);$('checkoutSubmit').textContent='Talebin kaydedildi ✓';rows=[];render();
 }catch(err){warn(err.message);btn.disabled=false}
});
load();
