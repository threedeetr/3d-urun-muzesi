// ThreeDee V6 - customer accounts, guest cart, account favorites.
const $=id=>document.getElementById(id);
let products=()=>[],onSelect=()=>{},notice=()=>{};
let customer=null,favs=new Set(),cart=new Map(),selected=null,tab='cart',loading=false,pendingCheckout=false;
const fmt=n=>new Intl.NumberFormat('tr-TR',{style:'currency',currency:'TRY'}).format(Number(n)||0);
const read=(name,otherwise)=>{try{return JSON.parse(localStorage.getItem(name))||otherwise}catch{return otherwise}};
const write=(name,val)=>{try{localStorage.setItem(name,JSON.stringify(val))}catch{}};
async function api(url,method='GET',body){const r=await fetch(url,{method,credentials:'same-origin',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,cache:'no-store'});const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.error||'İşlem başarısız.');return data;}
const product=id=>products().find(p=>p.id===id);
function hydrateGuest(){favs=new Set(read('threedee_guest_favorites',[]));cart=new Map(read('threedee_guest_cart',[]));}
function persistGuest(){write('threedee_guest_favorites',[...favs]);write('threedee_guest_cart',[...cart]);}
async function syncGuest(){
 const addFav=read('threedee_guest_favorites',[]),addCart=read('threedee_guest_cart',[]);
 const [savedFav,savedCart]=await Promise.all([api('/api/customer/favorites'),api('/api/customer/cart')]);
 favs=new Set(savedFav.ids);cart=new Map(savedCart.items.map(x=>[x.id,x.quantity]));
 for(const id of addFav){if(product(id)&&!favs.has(id)){await api('/api/customer/favorites','POST',{id,active:true});favs.add(id)}}
 for(const [id,qty] of addCart){const p=product(id);if(!p||p.isDemo||!p.active||p.stock<1)continue;const n=Math.min(p.stock,30,(cart.get(id)||0)+qty);await api('/api/customer/cart','POST',{id,quantity:n});cart.set(id,n)}
 write('threedee_guest_favorites',[]);write('threedee_guest_cart',[]);
}
async function load(){hydrateGuest();try{const data=await api('/api/customer/session');customer=data.user||null;if(customer)await syncGuest()}catch(e){console.warn('Müşteri oturumu:',e.message)}draw();}
function draw(){
 const count=[...cart.values()].reduce((a,v)=>a+v,0);
 $('shopCartCount').textContent=String(count);$('shopAccount').textContent=customer?'◉ '+customer.nickname:'♙ Giriş';
 $('shopVisitorName').textContent=customer?customer.nickname:'Misafir ziyaretçi';
 $('shopCheckout').textContent=customer?'Sipariş / ödeme adımına geç →':'Sepeti tamamlamak için giriş yap →';
 if(selected){$('shopFavProduct').textContent=favs.has(selected.id)?'♥ Favorilerimde':'♡ Favorilere ekle';$('shopFavProduct').classList.toggle('is-faved',favs.has(selected.id))}
 renderItems();
}
function renderItems(){
 const list=$('shopItems');if(!list)return;list.replaceChildren();const rows=tab==='cart'?[...cart.keys()]:[...favs];
 $('shopTabCart').classList.toggle('selected',tab==='cart');$('shopTabFav').classList.toggle('selected',tab==='favorites');
 $('shopTotalArea').hidden=tab!=='cart';$('shopCheckout').hidden=tab!=='cart';
 if(!rows.length){const empty=document.createElement('p');empty.className='shop-empty';empty.textContent=tab==='cart'?'Sepetin henüz boş. Müzedeki eserleri keşfet.':'Henüz favori ürünün yok.';list.append(empty)}
 let total=0;
 for(const id of rows){const p=product(id);if(!p)continue;const qty=cart.get(id)||0;if(tab==='cart')total+=p.price*qty;
  const row=document.createElement('article');row.className='shop-item';
  const image=document.createElement('div');image.className='shop-item-cover';if(p.photos?.[0]){const img=document.createElement('img');img.src=p.photos[0];img.alt='';image.append(img)}else image.textContent='◈';
  const info=document.createElement('div');info.className='shop-item-copy';const title=document.createElement('strong');title.textContent=p.name;
  const price=document.createElement('small');price.textContent=fmt(p.price);const view=document.createElement('button');view.className='shop-text-link';view.textContent='3D incele ↗';view.onclick=()=>{closePanel();onSelect(p)};
  info.append(title,price,view);
  const actions=document.createElement('div');actions.className='shop-item-actions';
  if(tab==='cart'){
   const less=document.createElement('button'),more=document.createElement('button');less.textContent='−';more.textContent='+';less.setAttribute('aria-label','Bir azalt');more.setAttribute('aria-label','Bir artır');
   const amount=document.createElement('span');amount.textContent=String(qty);
   less.onclick=()=>setQuantity(id,qty-1);more.onclick=()=>setQuantity(id,qty+1);actions.append(less,amount,more);
  }else{const del=document.createElement('button');del.textContent='♥';del.title='Favoriden kaldır';del.onclick=()=>setFavorite(p,false);actions.append(del)}
  row.append(image,info,actions);list.append(row);
 }
 $('shopTotal').textContent=fmt(total);
}
async function setQuantity(id,quantity){const p=product(id);if(!p)return;if(quantity>Math.min(p.stock,30)){notice('Stok adedini aşamazsın.');return}if(loading)return;
 loading=true;
 try{if(customer)await api('/api/customer/cart','POST',{id,quantity});if(quantity>0)cart.set(id,quantity);else cart.delete(id);if(!customer)persistGuest();draw();}
 catch(e){notice(e.message)}finally{loading=false}
}
async function setFavorite(p,on){if(loading)return;loading=true;try{if(customer)await api('/api/customer/favorites','POST',{id:p.id,active:on});if(on)favs.add(p.id);else favs.delete(p.id);if(!customer)persistGuest();draw();notice(on?'Favorilerine eklendi.':'Favorilerinden kaldırıldı.')}catch(e){notice(e.message)}finally{loading=false}}
function openPanel(name='cart'){tab=name;$('shopPanel').classList.add('open');$('shopLayer').hidden=false;draw();}
function closePanel(){$('shopPanel').classList.remove('open');$('shopLayer').hidden=true;}
function showAuth(mode='login'){
 $('shopAuthPanel').hidden=false;$('shopLayer').hidden=false;$('shopAuthPanel').dataset.mode=mode;
 $('authHeading').textContent=mode==='register'?'ThreeDee’ye katıl':'Hesabına giriş yap';
 $('authNameWrap').hidden=mode!=='register';$('authSubmit').textContent=mode==='register'?'Hesap oluştur':'Giriş yap';
 $('authSwitch').textContent=mode==='register'?'Zaten hesabın var mı? Giriş yap':'Hesabın yok mu? Kayıt ol';
 $('authFeedback').textContent='';
}
function hideAuth(){$('shopAuthPanel').hidden=true;$('shopLayer').hidden=!$('shopPanel').classList.contains('open');}
async function submitAuth(e){e.preventDefault();const form=$('shopAuthForm'),btn=$('authSubmit'),mode=$('shopAuthPanel').dataset.mode;btn.disabled=true;$('authFeedback').textContent='';
 try{const body={email:$('authEmail').value,password:$('authPassword').value,nickname:$('authName').value};
  const data=await api(mode==='register'?'/api/customer/register':'/api/customer/login','POST',body);
  if(data.verificationRequired){$('authFeedback').textContent='Hesabını doğrulamak için e-postana gelen bağlantıyı aç. Sonra giriş yap.';return}
  customer=data.user;await syncGuest();draw();hideAuth();notice('Hoş geldin, '+customer.nickname+'!');
  if(pendingCheckout){pendingCheckout=false;location.href='/checkout'}
 }catch(err){$('authFeedback').textContent=err.message}finally{btn.disabled=false}
}
function openAccount(){if(!customer){showAuth('login');return}const yes=confirm(`${customer.nickname} olarak giriş yaptın.\n\nÇıkış yapmak ister misin?`);if(yes)logout();}
async function logout(){try{await api('/api/customer/logout','POST');customer=null;hydrateGuest();draw();notice('Hesabından çıkış yapıldı.')}catch(e){notice(e.message)}}
export function setShopProduct(p){selected=p;if($('shopFavProduct')){$('shopAddProduct').disabled=!!(p.isDemo||!p.stock);draw();}}
export function initShop(opts){products=opts.products;onSelect=opts.openProduct;notice=opts.toast;
 $('shopAccount').addEventListener('click',openAccount);$('shopOpenCart').addEventListener('click',()=>openPanel('cart'));$('shopOpenFav').addEventListener('click',()=>openPanel('favorites'));
 $('shopClose').onclick=closePanel;$('shopCloseShade').onclick=()=>{closePanel();hideAuth()};$('shopLayer').addEventListener('click',e=>{if(e.target===$('shopLayer')){closePanel();hideAuth()}});
 $('shopTabCart').onclick=()=>{tab='cart';draw()};$('shopTabFav').onclick=()=>{tab='favorites';draw()};
 $('shopAddProduct').onclick=async()=>{if(!selected||selected.isDemo||selected.stock<1){notice('Bu ürün şu anda satışta değil.');return}await setQuantity(selected.id,(cart.get(selected.id)||0)+1);};
 $('shopFavProduct').onclick=()=>selected&&setFavorite(selected,!favs.has(selected.id));
 $('shopCheckout').onclick=()=>{if(!cart.size){notice('Sepetin boş.');return}if(customer)location.href='/checkout';else{pendingCheckout=true;showAuth('login')}};
 $('shopAuthForm').onsubmit=submitAuth;$('authClose').onclick=hideAuth;$('authSwitch').onclick=()=>showAuth($('shopAuthPanel').dataset.mode==='register'?'login':'register');
 $('shopProfileLogout').onclick=logout;$('shopProfileLogout').style.display='none';
 load();
 if(new URLSearchParams(location.search).get('login')==='1')showAuth('login');
}
