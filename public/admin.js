'use strict';
const $=id=>document.getElementById(id);
let products=[],editing=null,chosenFile=null,chosenPhotos=[],retainedPhotos=new Set(),photoPreviewUrls=[],toastTimer;
const money=n=>new Intl.NumberFormat('tr-TR',{style:'currency',currency:'TRY'}).format(Number(n)||0);
const icons={figure:'♛',dragon:'♜',ghost:'◉',holder:'▣',ballerina:'✦',stitch:'▦',cat:'♧',abstract:'◈'};
async function api(url, options={}){
 const res=await fetch(url,{credentials:'same-origin',...options});
 let body={};try{body=await res.json()}catch{}
 if(!res.ok)throw new Error(body.error||`Hata: ${res.status}`);return body;
}
function toast(msg){const el=$('adminToast');el.textContent=msg;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),3600)}
async function checkLogin(){
 try{const data=await api('/api/admin/session');if(data.authenticated)await showDashboard();else showLogin()}
 catch{showLogin()}
}
function showLogin(){$('loginSection').hidden=false;$('dashboard').hidden=true;$('logoutBtn').hidden=true;}
async function showDashboard(){$('loginSection').hidden=true;$('dashboard').hidden=false;$('logoutBtn').hidden=false;await refresh()}
async function refresh(){products=await api('/api/admin/products');
 $('totalCount').textContent=products.length;
 $('activeCount').textContent=products.filter(p=>p.active).length;
 $('modelCount').textContent=products.filter(p=>p.modelUrl).length;
 const list=$('adminProductList');list.replaceChildren();
 if(!products.length){const empty=document.createElement('p');empty.textContent='Henüz ürün eklenmedi. Yeni ürün ekle butonuyla başlayabilirsin.';list.append(empty);await loadAdminReviews();await loadAdminOrders();return}
 for(const p of products){
  const row=document.createElement('div');row.className='admin-product-row';row.tabIndex=0;row.setAttribute('role','button');
  const ico=document.createElement('span');ico.className='admin-product-icon';ico.style.color=p.color;
  if(p.photos?.length){const img=document.createElement('img');img.src=p.photos[0];img.alt='';img.loading='lazy';ico.append(img)}else ico.textContent=icons[p.shape]||'◈';
  const title=document.createElement('div');title.style.flex='1';
  const name=document.createElement('div');name.className='admin-product-name';name.textContent=p.name;
  const sub=document.createElement('div');sub.className='admin-product-sub';sub.textContent=p.previewError?'Önizleme sorunlu · düzenlemek için dokun':p.modelUrl?`${p.format.toUpperCase()} modeli hazır · ${p.photos?.length||0} fotoğraf`:`Temsili 3D model · ${p.photos?.length||0} fotoğraf`;
  const status=document.createElement('span');status.className='admin-status'+(p.active?'':' off');status.textContent=p.active?'Sergide':'Gizli';
  title.append(name,sub,status);
  const mid=document.createElement('div');mid.className='admin-product-mid';
  const price=document.createElement('div');price.className='admin-product-price';price.textContent=money(p.price);
  const stock=document.createElement('div');stock.className='admin-product-stock';stock.textContent=`${p.stock} adet stok`;
  mid.append(price,stock);
  const arrow=document.createElement('span');arrow.className='admin-product-action';arrow.textContent='↗';
  row.append(ico,title,mid,arrow);row.addEventListener('click',()=>openEditor(p));row.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openEditor(p)}});
  list.append(row);
 }
 await loadAdminReviews();await loadAdminOrders();
}
function openEditor(p=null){
 editing=p;chosenFile=null;chosenPhotos=[];retainedPhotos=new Set(p?.photos||[]);clearPhotoPreviews();$('productForm').reset();$('modelFile').value='';$('photoFiles').value='';
 $('name').value=p?.name||'';$('price').value=p?.price??299;$('stock').value=p?.stock??1;
 $('description').value=p?.description||'';$('shape').value=p?.shape||'abstract';$('color').value=p?.color||'#bba68b';$('active').checked=p?.active??true;
 $('editorTitle').textContent=p?'Ürünü düzenle':'Yeni ürün ekle';
 $('existingFile').textContent=p?.previewError?`⚠ ${p.previewError} · Yeni dosya seçerek değiştirebilirsin.`:p?.modelUrl?`Yüklü dosya: ${p.format.toUpperCase()} · Değiştirmek için yeni bir dosya seç.`:'Henüz model dosyası yok; temsili model gösterilecektir.';
 $('fileLabel').textContent='3MF, GLB veya STL seç';$('deleteProduct').hidden=!p;$('editorMessage').textContent='';renderExistingPhotos();renderPhotoSelection();
 $('adminShade').hidden=false;$('editor').classList.add('open');$('editor').setAttribute('aria-hidden','false');
}
function closeEditor(){clearPhotoPreviews();$('adminShade').hidden=true;$('editor').classList.remove('open');$('editor').setAttribute('aria-hidden','true')}
function chooseFile(file){
 if(!file)return;
 const ext=file.name.toLowerCase().split('.').pop();
 if(!['3mf','glb','stl'].includes(ext)){$('editorMessage').textContent='Yalnızca 3MF, GLB veya STL dosyası seçebilirsin.';$('modelFile').value='';return;}
 if(file.size>32*1024*1024){$('editorMessage').textContent='Dosya 32 MB sınırını geçiyor.';$('modelFile').value='';return;}
 chosenFile=file;$('fileLabel').textContent=file.name;$('editorMessage').textContent='';
}
function clearPhotoPreviews(){for(const url of photoPreviewUrls)URL.revokeObjectURL(url);photoPreviewUrls=[]}
function renderExistingPhotos(){
 const grid=$('existingPhotos');grid.replaceChildren();const photos=editing?.photos||[];
 if(!photos.length){grid.textContent='Henüz fotoğraf eklenmemiş.';return}
 for(const url of photos){
  const wrap=document.createElement('div');wrap.className='admin-photo-item';
  const img=document.createElement('img');img.src=url;img.alt='Yüklü ürün fotoğrafı';
  const btn=document.createElement('button');btn.type='button';const keep=retainedPhotos.has(url);
  btn.className='admin-mini-btn'+(keep?'':' marked');btn.textContent=keep?'Kaldır':'Geri al';
  wrap.classList.toggle('photo-removed',!keep);
  btn.addEventListener('click',()=>{if(retainedPhotos.has(url))retainedPhotos.delete(url);else retainedPhotos.add(url);renderExistingPhotos();renderPhotoSelection()});
  wrap.append(img,btn);grid.append(wrap);
 }
}
function renderPhotoSelection(){
 const el=$('photoSelection');el.replaceChildren();clearPhotoPreviews();
 if(!chosenPhotos.length){el.textContent=`Yeni fotoğraf seçilmedi · toplam ${retainedPhotos.size}/6`;return}
 const note=document.createElement('div');note.textContent=`${chosenPhotos.length} yeni fotoğraf · toplam ${retainedPhotos.size+chosenPhotos.length}/6`;el.append(note);
 const gallery=document.createElement('div');gallery.className='admin-photo-grid';
 for(const f of chosenPhotos){const img=document.createElement('img');const url=URL.createObjectURL(f);photoPreviewUrls.push(url);img.src=url;img.alt=f.name;gallery.append(img)}
 el.append(gallery);
}
function choosePhotos(files){
 chosenPhotos=Array.from(files||[]);const max=6-retainedPhotos.size;
 if(chosenPhotos.length>max){$('editorMessage').textContent=`En fazla ${max} yeni fotoğraf seçebilirsin. Önce eski fotoğrafları kaldırabilirsin.`;chosenPhotos=[];$('photoFiles').value='';}
 else if(chosenPhotos.some(f=>f.size>4*1024*1024||!['image/jpeg','image/png','image/webp'].includes(f.type))){
  $('editorMessage').textContent='Her fotoğraf JPG/PNG/WEBP ve en fazla 4 MB olmalı.';chosenPhotos=[];$('photoFiles').value='';
 }else $('editorMessage').textContent='';
 renderPhotoSelection();
}
async function loadAdminReviews(){
 const el=$('adminReviewList');el.textContent='Yorumlar yükleniyor…';
 try{const reviews=await api('/api/admin/reviews');el.replaceChildren();
  if(!reviews.length){el.textContent='Henüz ziyaretçi yorumu yok.';return}
  for(const r of reviews){const card=document.createElement('article');card.className='admin-review-card';
   const head=document.createElement('div');head.className='admin-review-head';
   const title=document.createElement('strong');title.textContent=r.scope==='museum'?'Müze defteri':`Ürün: ${products.find(p=>p.id===r.productId)?.name||'Silinmiş ürün'}`;
   const meta=document.createElement('small');meta.textContent=`${r.name}${r.rating?' · '+'★'.repeat(r.rating):''} · ${new Date(r.createdAt).toLocaleDateString('tr-TR')}`;
   head.append(title,meta);
   const message=document.createElement('p');message.textContent=r.message;
   const del=document.createElement('button');del.type='button';del.className='danger-btn';del.textContent='Yorumu sil';
   del.addEventListener('click',async()=>{if(!confirm('Bu ziyaretçi yorumunu silmek istiyor musun?'))return;
    try{await api('/api/admin/reviews/'+encodeURIComponent(r.id),{method:'DELETE'});card.remove();toast('Yorum silindi.')}catch(err){toast(err.message)}
   });card.append(head,message,del);el.append(card);
  }
 }catch(err){el.textContent=err.message}
}
async function loadAdminOrders(){
 const el=$('adminOrders');if(!el)return;el.textContent='Talepler yükleniyor…';
 try{const data=await api('/api/admin/orders');el.replaceChildren();if(!data.orders?.length){el.textContent='Henüz sipariş talebi yok.';return}
  for(const o of data.orders){const card=document.createElement('article');card.className='admin-review-card';
   const title=document.createElement('strong');title.textContent=`Talep #${o.id.slice(0,8)} · ${new Date(o.created_at).toLocaleString('tr-TR')}`;
   const details=document.createElement('p');details.textContent=`${o.recipient} · ${o.phone} · ${o.city} / ${o.address}`;
   const items=document.createElement('p');items.textContent=(o.items||[]).map(p=>`${p.name} × ${p.quantity}`).join(' · ');
   const total=document.createElement('strong');total.textContent=`Toplam: ${money(o.total)} · Ödeme alınmadı`;
   const note=document.createElement('p');note.textContent=o.note?`Not: ${o.note}`:'';
   const select=document.createElement('select');for(const [value,label] of [['new','Yeni talep'],['contacted','İletişime geçildi'],['cancelled','İptal']]){const opt=document.createElement('option');opt.value=value;opt.textContent=label;select.append(opt)}
   select.value=o.status;select.className='admin-order-status';select.addEventListener('change',async()=>{
    try{await api(`/api/admin/orders/${o.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:select.value})});toast('Talep durumu güncellendi.')}catch(e){toast(e.message);select.value=o.status}
   });
   card.append(title,details,items,total,note,select);el.append(card);
  }
 }catch(e){el.textContent='Sipariş listesi yüklenemedi: '+e.message+' (Supabase V6 SQL kodunu çalıştırdın mı?)'}
}
$('refreshOrders').addEventListener('click',loadAdminOrders);
$('refreshReviews').addEventListener('click',loadAdminReviews);
$('photoFiles').addEventListener('change',e=>choosePhotos(e.target.files));
$('loginForm').addEventListener('submit',async e=>{
 e.preventDefault();const btn=e.currentTarget.querySelector('button');btn.disabled=true;$('loginMessage').textContent='';
 try{await api('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:$('adminPassword').value})});$('adminPassword').value='';await showDashboard();}
 catch(err){$('loginMessage').textContent=err.message}finally{btn.disabled=false}
});
$('logoutBtn').addEventListener('click',async()=>{try{await api('/api/admin/logout',{method:'POST'});closeEditor();showLogin();toast('Yönetim panelinden çıkıldı.')}catch(err){toast(err.message)}});
$('newProductBtn').addEventListener('click',()=>openEditor());
$('closeEditor').addEventListener('click',closeEditor);$('adminShade').addEventListener('click',closeEditor);
$('modelFile').addEventListener('change',e=>chooseFile(e.target.files[0]));
const drop=$('dropArea');
for(const type of ['dragenter','dragover'])drop.addEventListener(type,e=>{e.preventDefault();drop.classList.add('drag-over')});
for(const type of ['dragleave','drop'])drop.addEventListener(type,e=>{e.preventDefault();drop.classList.remove('drag-over')});
drop.addEventListener('drop',e=>chooseFile(e.dataTransfer?.files?.[0]));
$('productForm').addEventListener('submit',async e=>{
 e.preventDefault();const btn=$('saveProduct');btn.disabled=true;btn.textContent=chosenFile?'3D önizleme hazırlanıyor…':'Kaydediliyor…';$('editorMessage').textContent='';
 const p={name:$('name').value,price:Number($('price').value),stock:Number($('stock').value),description:$('description').value,
 shape:$('shape').value,color:$('color').value,active:$('active').checked};
 p.keepPhotos=[...retainedPhotos];
 const form=new FormData();form.append('payload',JSON.stringify(p));if(chosenFile)form.append('file',chosenFile,chosenFile.name);
 for(const file of chosenPhotos)form.append('photos',file,file.name);
 try{
  let result;
  if(editing)result=await api(`/api/admin/products/${editing.id}`,{method:'PUT',body:form});
  else result=await api('/api/admin/products',{method:'POST',body:form});
  closeEditor();await refresh();toast(result.previewError?'Ürün kaydedildi ancak model önizlemesi oluşturulamadı. Ürünü düzenleyerek optimize model yükleyin.':editing?'Ürün güncellendi ve müzede yayınlandı.':'Ürün eklendi ve müzede yayınlandı.');
 }catch(err){$('editorMessage').textContent=err.message}finally{btn.disabled=false;btn.textContent='Kaydet ve yayınla →'}
});
$('deleteProduct').addEventListener('click',async()=>{
 if(!editing)return;
 if(!confirm(`"${editing.name}" adlı ürünü ve yüklenen dosyasını silmek istediğine emin misin?`))return;
 try{await api(`/api/admin/products/${editing.id}`,{method:'DELETE'});closeEditor();await refresh();toast('Ürün müzeden kaldırıldı.')}
 catch(err){$('editorMessage').textContent=err.message}
});
window.addEventListener('keydown',e=>{if(e.key==='Escape')closeEditor()});
checkLogin();
