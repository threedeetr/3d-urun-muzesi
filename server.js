'use strict';
// 3D Müze | dependencies-free Node.js backend (Node 20+)
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Worker } = require('node:worker_threads');
const cloud = require('./supabase-store.js');
const commerce = require('./customer-v6.js');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'storage'));
const UPLOADS = path.join(DATA, 'uploads');
const DB = path.join(DATA, 'products.json');
const REVIEWS_DB = path.join(DATA, 'reviews.json');
const MAX_PHOTOS = 6;
const MAX_PHOTO = 4 * 1024 * 1024;
const reviewRate = new Map();
const PORT = Number(process.env.PORT || 3000);
const MAX_FILE = 32 * 1024 * 1024;
const MAX_BODY = MAX_FILE + MAX_PHOTOS * MAX_PHOTO + 1024 * 1024;
const PASSWORD = process.env.ADMIN_PASSWORD || crypto.randomBytes(15).toString('base64url');
const sessions = new Map();
const loginAttempts = new Map();
fs.mkdirSync(UPLOADS, { recursive: true });

const seed = [
  ['Diva Figürü', 399, 6, 'Koleksiyon figürü için örnek vitrin. Kendi 3MF modelini yükleyerek değiştirebilirsin.', 'figure', '#d75a9e'],
  ['Ejderha Lamba', 749, 4, 'Işıklı dekor ürününün temsili modeli. Gerçek baskı dosyasını admin panelinden yükle.', 'dragon', '#bc8b5e'],
  ['Minik Hayalet', 229, 12, 'Sevimli masaüstü dekor; örnek sergi ürünü.', 'ghost', '#eee0c8'],
  ['Modern Kartvizitlik', 299, 8, 'Çalışma masalarına zarif bir dokunuş; örnek ürün.', 'holder', '#343a4c'],
  ['Balerin Figürü', 259, 7, 'Dönen masaüstü balerin; temsili sergi modeli.', 'ballerina', '#c8a0b4'],
  ['İlmeka Mini Panel', 349, 10, 'İlmek ilmek sanat: örnek mini kanaviçe paneli.', 'stitch', '#b6b8a5'],
  ['Kedi & Fare', 319, 5, 'Eğlenceli dekor: örnek 3D sergi modeli.', 'cat', '#ad9d88'],
  ['Soyut Sanat Objesi', 449, 3, 'Galeriyi doldurmak için temsili heykel.', 'abstract', '#a4ab9c']
].map(([name,price,stock,description,shape,color], i) => ({
  id: `demo-${i+1}`, name, price, stock, description, shape, color,
  modelUrl: null, format: null, isDemo: true, active: true, createdAt: new Date().toISOString()
}));
if (!fs.existsSync(DB)) fs.writeFileSync(DB, JSON.stringify(seed, null, 2));
if (!fs.existsSync(REVIEWS_DB)) fs.writeFileSync(REVIEWS_DB, '[]');
async function loadProducts() {
  if(cloud.enabled) return cloud.listProducts();
  try { const x=JSON.parse(fs.readFileSync(DB,'utf8')); return Array.isArray(x) ? x : []; }
  catch (e) { console.error('Ürün verisi okunamadı:',e.message); return []; }
}
function saveProducts(rows) {
  const tmp = DB + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(rows, null, 2)); fs.renameSync(tmp, DB);
}
async function loadReviews(){
 if(cloud.enabled)return cloud.reviewsAll();
 try{const data=JSON.parse(fs.readFileSync(REVIEWS_DB,'utf8'));return Array.isArray(data)?data:[]}
 catch(err){console.error('Yorum verisi okunamadı:',err.message);return []}
}
function saveReviews(rows){const temp=REVIEWS_DB+'.tmp';fs.writeFileSync(temp,JSON.stringify(rows,null,2));fs.renameSync(temp,REVIEWS_DB)}
function ratingSummary(productId,reviews){const rows=reviews.filter(r=>r.scope==='product'&&r.productId===productId);return {count:rows.length,average:rows.length?Math.round(rows.reduce((n,r)=>n+r.rating,0)/rows.length*10)/10:0}}
function pagedReviews(rows,url){const page=Math.max(1,Math.min(100000,Number.parseInt(url.searchParams.get('page'),10)||1));const limit=10;const items=rows.slice((page-1)*limit,page*limit);return {items,total:rows.length,page,hasMore:page*limit<rows.length}}
function checkReviewRate(req,scope,productId){const ip=String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'unknown').split(',')[0];const key=crypto.createHash('sha256').update(ip+'|'+scope+'|'+(productId||'')).digest('hex');const now=Date.now();
 for(const [k,v] of reviewRate)if(now-v.last>3600000)reviewRate.delete(k);
 const record=reviewRate.get(key)||{last:0,history:[]};record.history=record.history.filter(t=>now-t<3600000);
 if(now-record.last<60_000||record.history.length>=8)throw Object.assign(new Error('Çok sık yorum gönderiyorsun. Bir süre sonra tekrar dene.'),{status:429});
 record.last=now;record.history.push(now);reviewRate.set(key,record);
}
async function addReview(req,scope,productId,data){
 if(data.website) return {ok:true}; // Görünmez spam alanı
 const name=String(data.name||'').trim().replace(/\s+/g,' ').slice(0,35);
 const message=String(data.message||'').trim().slice(0,700);
 if(name.length<2||message.length<3||String(data.name||'').length>80||String(data.message||'').length>1000)throw Object.assign(new Error('Ad (2–35) ve yorum (3–700 karakter) gerekli.'),{status:400});
 if(/https?:\/\/|www\./i.test(message))throw Object.assign(new Error('Yorumlarda bağlantı paylaşılamaz.'),{status:400});
 let rating=null;if(scope==='product'){rating=Number(data.rating);if(!Number.isInteger(rating)||rating<1||rating>5)throw Object.assign(new Error('1–5 yıldız arasında puan seç.'),{status:400})}
 checkReviewRate(req,scope,productId);
 const review={id:crypto.randomUUID(),scope,productId:productId||null,name,message,rating,createdAt:new Date().toISOString()};
 if(cloud.enabled){
   // Each comment gets its own DB row, preventing concurrent visitor comments from overwriting each other.
   await cloud.createReview(review);
 }else{
   const rows=await loadReviews();if(rows.length>=10000)throw Object.assign(new Error('Yorum defteri dolu; yöneticiye haber ver.'),{status:507});
   rows.unshift(review);saveReviews(rows);
 }
 return {ok:true,review};
}
const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.svg':'image/svg+xml', '.3mf':'model/3mf', '.glb':'model/gltf-binary', '.stl':'model/stl', '.webp':'image/webp', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.png':'image/png', '.ogg':'audio/ogg' };
function reply(res, code, payload, headers={}) {
  const isJson = typeof payload !== 'string' && !Buffer.isBuffer(payload);
  const body = isJson ? Buffer.from(JSON.stringify(payload)) : payload;
  res.writeHead(code, {'Content-Type':isJson?'application/json; charset=utf-8':'text/plain; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});
  res.end(body);
}
function serveFile(res, filename, cache=false) {
  fs.stat(filename,(err,stat)=>{
    if(err || !stat.isFile()) return reply(res,404,{error:'Dosya bulunamadı.'});
    res.writeHead(200,{'Content-Type':types[path.extname(filename).toLowerCase()] || 'application/octet-stream','Content-Length':stat.size,'X-Content-Type-Options':'nosniff','Cache-Control':cache?'public, max-age=3600':'no-store'});
    fs.createReadStream(filename).pipe(res);
  });
}
function readRaw(req, max=MAX_BODY) {return new Promise((resolve,reject)=>{
  const chunks=[]; let len=0;
  req.on('data', chunk=>{len+=chunk.length;if(len>max){reject(Object.assign(new Error('Dosya çok büyük (en fazla 32 MB).'),{status:413}));req.destroy();}else chunks.push(chunk)});
  req.on('end',()=>resolve(Buffer.concat(chunks)));
  req.on('error',reject);
});}
async function readJson(req) {const b=await readRaw(req, 32*1024);try {return JSON.parse(b.toString('utf8'));}catch {throw Object.assign(new Error('Geçersiz JSON.'),{status:400});}}
function parseMultipart(buf, ct) {
  const match = /boundary=(?:"([^"]+)"|([^; ]+))/.exec(ct||'');
  if(!match) throw Object.assign(new Error('Form verisi eksik.'),{status:400});
  const boundary=Buffer.from('--'+(match[1]||match[2]));
  const out={fields:{},file:null,photos:[]}; let pos=buf.indexOf(boundary);
  while(pos>=0){
    let start=pos+boundary.length;
    if(buf.subarray(start,start+2).toString()==='--') break;
    if(buf.subarray(start,start+2).toString()!=='\r\n') throw new Error('Bozuk form sınırı.');
    start+=2;
    const headEnd=buf.indexOf('\r\n\r\n',start); if(headEnd<0) throw new Error('Bozuk form başlığı.');
    const headers=buf.subarray(start,headEnd).toString('utf8');
    const m=/name="([^"]+)"(?:; filename="([^"]*)")?/i.exec(headers);
    const dataStart=headEnd+4; const next=buf.indexOf(Buffer.concat([Buffer.from('\r\n'),boundary]),dataStart);
    if(next<0) throw new Error('Form sonu eksik.');
    if(m){const name=m[1], filename=m[2];
      if(filename!==undefined && filename.length && name==='file') out.file={filename,buffer:buf.subarray(dataStart,next)};
      else if(filename!==undefined && filename.length && name==='photos') out.photos.push({filename,buffer:buf.subarray(dataStart,next)});
      else if(filename===undefined && name.length<100) out.fields[name]=buf.subarray(dataStart,next).toString('utf8');
    }
    pos=next+2;
  }
  return out;
}
function session(req){
  const cookies=String(req.headers.cookie||'').split(';').map(s=>s.trim());
  const raw=cookies.find(c=>c.startsWith('museum_session='));if(!raw) return false;
  const token=raw.slice('museum_session='.length);const until=sessions.get(token);
  if(!until) return false;if(until<Date.now()){sessions.delete(token);return false;}return true;
}
function tokenFromReq(req){const c=String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('museum_session='));return c?.slice('museum_session='.length);}
function auth(req,res){if(!session(req)){reply(res,401,{error:'Önce admin girişi yapın.'});return false;}return true;}
function cookie(req,token,age){
 const secure=(req.socket.encrypted || req.headers['x-forwarded-proto']==='https')?'; Secure':'';
 return `museum_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${secure}`;
}
function sanitize(p, previous={}) {
  if(typeof p !== 'object'||!p)throw Object.assign(new Error('Ürün bilgisi bulunamadı.'),{status:400});
  const name=String(p.name||'').trim().slice(0,78);
  if(name.length<2)throw Object.assign(new Error('Ürün adı en az 2 karakter olmalı.'),{status:400});
  const price=Number(p.price), stock=Number(p.stock);
  if(!Number.isFinite(price)||price<0||price>10000000)throw Object.assign(new Error('Geçersiz fiyat.'),{status:400});
  if(!Number.isInteger(stock)||stock<0||stock>10000000)throw Object.assign(new Error('Adet negatif olamaz.'),{status:400});
  const color=/^#[0-9a-f]{6}$/i.test(p.color)?p.color:'#bca78e';
  const validShapes=['figure','dragon','ghost','holder','ballerina','stitch','cat','abstract'];
  return {...previous,name, price,stock,description:String(p.description||'').slice(0,1800),color,
    shape:validShapes.includes(p.shape)?p.shape:'abstract',active:p.active===true||p.active==='true'};
}
function saveUpload(file){
  if(!file) return null;
  const ext=path.extname(file.filename).toLowerCase();
  if(!['.3mf','.glb','.stl'].includes(ext))throw Object.assign(new Error('Yalnızca 3MF, GLB veya STL yüklenebilir.'),{status:400});
  if(file.buffer.length > MAX_FILE)throw Object.assign(new Error('Maksimum dosya boyutu 32 MB.'),{status:413});
  if(ext==='.3mf' && file.buffer.subarray(0,2).toString()!=='PK')throw Object.assign(new Error('3MF dosyası geçerli görünmüyor.'),{status:400});
  if(ext==='.glb' && file.buffer.subarray(0,4).toString()!=='glTF')throw Object.assign(new Error('GLB dosyası geçerli görünmüyor.'),{status:400});
  const name=crypto.randomUUID()+ext;
  fs.writeFileSync(path.join(UPLOADS,name),file.buffer,{flag:'wx'});
  return {modelUrl:'/uploads/'+name,format:ext.slice(1),size:file.buffer.length};
}
function savePhotos(files){
 if(files.length>MAX_PHOTOS)throw Object.assign(new Error('En fazla 6 fotoğraf yükleyebilirsin.'),{status:400});
 const saved=[];
 try {for(const file of files){
  const ext=path.extname(file.filename).toLowerCase();const b=file.buffer;
  const jpeg=['.jpg','.jpeg'].includes(ext)&&b.length>=3&&b[0]===255&&b[1]===216&&b[2]===255;
  const png=ext==='.png'&&b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const webp=ext==='.webp'&&b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WEBP';
  if(!jpeg&&!png&&!webp)throw Object.assign(new Error('Fotoğraflar JPG, PNG veya WEBP olmalı.'),{status:400});
  if(b.length>MAX_PHOTO)throw Object.assign(new Error('Her fotoğraf en fazla 4 MB olabilir.'),{status:413});
  const name=crypto.randomUUID()+(jpeg?'.jpg':ext);fs.writeFileSync(path.join(UPLOADS,name),b,{flag:'wx'});saved.push('/uploads/'+name);
 }return saved}catch(err){saved.forEach(safeDeleteUrl);throw err}
}
function keepExistingPhotos(data,previous){const existing=Array.isArray(previous.photos)?previous.photos:[];
 if(data.keepPhotos===undefined)return existing.slice();
 if(!Array.isArray(data.keepPhotos)||data.keepPhotos.some(u=>!existing.includes(u)))throw Object.assign(new Error('Fotoğraf listesi geçersiz.'),{status:400});
 return [...new Set(data.keepPhotos)];
}
async function safeDeleteUrl(url){
 if(cloud.enabled && cloud.objectRef(url)){
  try{await cloud.deleteObject(url)}catch(err){console.warn('Bulut dosyası silinemedi:',err.message)}
  return;
 }
 if(typeof url==='string' && /^\/uploads\/[a-f0-9-]{36}\.(3mf|glb|stl|jpg|jpeg|png|webp)$/i.test(url)){
  try{fs.unlinkSync(path.join(UPLOADS,path.basename(url)))}catch{}
 }
}
async function removeUpload(product){await Promise.all([product?.modelUrl,product?.previewUrl,...(product?.photos||[])].filter(Boolean).map(safeDeleteUrl));}
const MIME={'.3mf':'model/3mf','.stl':'model/stl','.glb':'model/gltf-binary','.jpeg':'image/jpeg','.jpg':'image/jpeg','.png':'image/png','.webp':'image/webp'};
async function promoteModel(upload,preview){
 if(!cloud.enabled || !upload)return {...(upload?{modelUrl:upload.modelUrl,format:upload.format}:{}),...preview};
 const localFiles=[upload.modelUrl,preview.previewUrl].filter(Boolean);
 const created=[];
 try{
  const originalPath=path.join(UPLOADS,path.basename(upload.modelUrl));
  const modelUrl=await cloud.uploadObject(cloud.ORIGINALS,path.basename(upload.modelUrl),fs.readFileSync(originalPath),MIME[path.extname(originalPath)]);
  created.push(modelUrl);
  let previewUrl=null;
  if(preview.previewUrl){
   const previewPath=path.join(UPLOADS,path.basename(preview.previewUrl));
   previewUrl=await cloud.uploadObject(cloud.MEDIA,path.basename(preview.previewUrl),fs.readFileSync(previewPath),MIME[path.extname(previewPath)]);
   created.push(previewUrl);
  }
  return {modelUrl,format:upload.format,...preview,previewUrl};
 }catch(err){await Promise.all(created.map(safeDeleteUrl));throw err}
 finally{await Promise.all(localFiles.map(safeDeleteUrl));}
}
async function promotePhotos(urls){
 if(!cloud.enabled)return urls;
 const created=[];
 try{
  for(const localUrl of urls){
   const localPath=path.join(UPLOADS,path.basename(localUrl));
   const remote=await cloud.uploadObject(cloud.MEDIA,path.basename(localUrl),fs.readFileSync(localPath),MIME[path.extname(localPath)]);
   created.push(remote);
  }
  return created;
 }catch(err){await Promise.all(created.map(safeDeleteUrl));throw err}
 finally{await Promise.all(urls.map(safeDeleteUrl));}
}
function runPreviewWorker(source,target,format){return new Promise((resolve,reject)=>{
 const worker=new Worker(path.join(ROOT,'model-preview-worker.js'),{
   workerData:{source,target,format},resourceLimits:{maxOldGenerationSizeMb:256,maxYoungGenerationSizeMb:32}
 });
 let finished=false;
 const timer=setTimeout(()=>{if(finished)return;finished=true;worker.terminate();reject(new Error('Önizleme dönüştürmesi zaman aşımına uğradı.'))},22000);
 const finish=(err,result)=>{if(finished)return;finished=true;clearTimeout(timer);worker.terminate();if(err)reject(err);else resolve(result)};
 worker.on('message',msg=>msg.ok?finish(null,msg):finish(new Error(msg.error||'Önizleme oluşturulamadı.')));
 worker.on('error',err=>finish(err));
 worker.on('exit',code=>{if(!finished)finish(new Error('Önizleme işçisi kapandı: '+code))});
 });}
async function preparePreview(upload){
 if(!upload)return {};
 if(upload.format==='glb'){
  return upload.size<=6*1024*1024 ? {previewUrl:upload.modelUrl} : {previewError:'GLB dosyası mobil önizleme için büyük. 6 MB altında optimize GLB yükleyin.'};
 }
 const filename=crypto.randomUUID()+'.glb',target=path.join(UPLOADS,filename);
 try{
  const result=await runPreviewWorker(path.join(UPLOADS,path.basename(upload.modelUrl)),target,upload.format);
  return {previewUrl:'/uploads/'+filename,previewTriangles:result.triangles};
 }catch(err){
  console.warn('Önizleme oluşturulamadı:',err.message);try{fs.unlinkSync(target)}catch{}
  return {previewError:'3D önizleme oluşturulamadı. Daha küçük/onarılmış bir 3MF veya optimize GLB deneyin.'};
 }
}
// Kalıcı diski olan mevcut kurulumlarda eski ürünler de otomatik önizlemeye kavuşsun.
async function backfillPreviews(){
 if(cloud.enabled)return;
 const rows=await loadProducts();
 for(const original of rows){
  if(!original.modelUrl || original.previewUrl || original.previewError || !['3mf','stl'].includes(original.format))continue;
  if(!fs.existsSync(path.join(UPLOADS,path.basename(original.modelUrl))))continue;
  const prepared=await preparePreview({...original,size:fs.statSync(path.join(UPLOADS,path.basename(original.modelUrl))).size});
  const fresh=await loadProducts(),index=fresh.findIndex(p=>p.id===original.id);
  if(index>=0&&fresh[index].modelUrl===original.modelUrl){Object.assign(fresh[index],prepared);saveProducts(fresh)}
 }
}

function validOrigin(req){
 const o=req.headers.origin;if(!o)return true;
 try{return new URL(o).host===req.headers.host;}catch{return false;}
}
async function handle(req,res){
 const method=req.method || 'GET';const url=new URL(req.url,'http://localhost');const pathname=url.pathname;
 if(['POST','PUT','PATCH','DELETE'].includes(method) && !validOrigin(req))return reply(res,403,{error:'İsteğe izin verilmedi.'});
 if(method==='GET'&&pathname==='/api/health')return reply(res,200,{status:'ok',storage:cloud.enabled?'supabase':'local'});
 // V6: customer account, favorites, cart, order requests and live visitors.
 if(pathname==='/api/presence' && ['GET','POST'].includes(method)){
  const position=method==='POST'?await readJson(req):null;
  return reply(res,200,commerce.presence(req,res,position));
 }
 if(pathname==='/api/customer/session'&&method==='GET'){
  const user=commerce.enabled?await commerce.findUser(req,res):null;
  return reply(res,200,{authenticated:!!user,user:user||null});
 }
 if(pathname==='/api/customer/register'&&method==='POST')return reply(res,200,await commerce.authCall(req,res,'register',await readJson(req)));
 if(pathname==='/api/customer/login'&&method==='POST')return reply(res,200,await commerce.authCall(req,res,'login',await readJson(req)));
 if(pathname==='/api/customer/logout'&&method==='POST'){
  commerce.clearSession(req,res);return reply(res,200,{ok:true});
 }
 if(pathname.startsWith('/api/customer/') ){
  const user=await commerce.requireUser(req,res);
  if(pathname==='/api/customer/favorites'){
   if(method==='GET')return reply(res,200,{ids:await commerce.favorites(user.id)});
   if(method==='POST'){
    const data=await readJson(req),id=String(data.id||'');
    if(!/^[a-z0-9-]{1,90}$/i.test(id))return reply(res,400,{error:'Ürün bulunamadı.'});
    if(data.active===true){const rows=await loadProducts();if(!rows.some(p=>p.id===id&&p.active))return reply(res,404,{error:'Ürün bulunamadı.'})}
    await commerce.favorite(user.id,id,data.active===true);return reply(res,200,{ok:true});
   }
  }
  if(pathname==='/api/customer/cart'){
   if(method==='GET')return reply(res,200,{items:await commerce.cart(user.id)});
   if(method==='POST'){
    const data=await readJson(req),id=String(data.id||''),quantity=Number(data.quantity);
    if(!/^[a-z0-9-]{1,90}$/i.test(id)||!Number.isInteger(quantity)||quantity<0||quantity>30)return reply(res,400,{error:'Ürün veya adet geçersiz.'});
    if(quantity){const rows=await loadProducts(),product=rows.find(p=>p.id===id&&p.active&&!p.isDemo);if(!product)return reply(res,404,{error:'Ürün satışta değil.'});if(quantity>product.stock)return reply(res,409,{error:'Stokta yeterli adet yok.'})}
    await commerce.setCart(user.id,id,quantity);return reply(res,200,{ok:true});
   }
  }
  if(pathname==='/api/customer/orders'){
   if(method==='GET')return reply(res,200,{orders:await commerce.orders(user.id)});
   if(method==='POST')return reply(res,201,{ok:true,order:await commerce.makeOrder(user.id,await readJson(req),await loadProducts())});
  }
  return reply(res,404,{error:'Müşteri işlemi bulunamadı.'});
 }
 if(method==='GET'&&pathname==='/api/products'){
  const products=await loadProducts();const ratings=cloud.enabled?await cloud.ratings():null;
  const reviews=cloud.enabled?null:await loadReviews();
  return reply(res,200,products.filter(p=>p.active).map(p=>({...p,modelUrl:cloud.enabled?(p.previewUrl||null):p.modelUrl,photos:p.photos||[],rating:ratings?(ratings[p.id]||{count:0,average:0}):ratingSummary(p.id,reviews)})));
 }
 if(pathname==='/api/guestbook' && method==='GET')return reply(res,200,cloud.enabled?await cloud.reviewsPage({scope:'museum',page:url.searchParams.get('page')}):pagedReviews((await loadReviews()).filter(r=>r.scope==='museum'),url));
 if(pathname==='/api/guestbook' && method==='POST')return reply(res,201,await addReview(req,'museum',null,await readJson(req)));
 const publicReview=/^\/api\/products\/([a-zA-Z0-9-]+)\/reviews$/.exec(pathname);
 if(publicReview&&(method==='GET'||method==='POST')){
  const product=(await loadProducts()).find(p=>p.id===publicReview[1]&&p.active);
  if(!product)return reply(res,404,{error:'Ürün bulunamadı.'});
  if(method==='POST')return reply(res,201,await addReview(req,'product',product.id,await readJson(req)));
  if(cloud.enabled){const [page,ratings]=await Promise.all([cloud.reviewsPage({scope:'product',productId:product.id,page:url.searchParams.get('page')}),cloud.ratings()]);return reply(res,200,{...page,rating:ratings[product.id]||{count:0,average:0}})}
  const reviews=await loadReviews();return reply(res,200,{...pagedReviews(reviews.filter(r=>r.scope==='product'&&r.productId===product.id),url),rating:ratingSummary(product.id,reviews)});
 }
 if(method==='POST'&&pathname==='/api/admin/login'){
   const ip=String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'unknown').split(',')[0];
   let attempts=loginAttempts.get(ip)||{n:0,time:Date.now()};
   if(Date.now()-attempts.time>15*60*1000)attempts={n:0,time:Date.now()};
   if(attempts.n>=9) return reply(res,429,{error:'Çok fazla deneme. 15 dakika sonra tekrar deneyin.'});
   const data=await readJson(req);const candidate=crypto.createHash('sha256').update(String(data.password||'')).digest();
   const expected=crypto.createHash('sha256').update(PASSWORD).digest();
   if(!crypto.timingSafeEqual(candidate,expected)){attempts.n++;loginAttempts.set(ip,attempts);return reply(res,401,{error:'Şifre yanlış.'});}
   loginAttempts.delete(ip);
   const token=crypto.randomBytes(32).toString('hex');sessions.set(token,Date.now()+12*3600000);
   return reply(res,200,{ok:true},{'Set-Cookie':cookie(req,token,12*3600)});
 }
 if(method==='GET'&&pathname==='/api/admin/session')return reply(res,200,{authenticated:session(req)});
 if(method==='POST'&&pathname==='/api/admin/logout'){
   const token=tokenFromReq(req);if(token)sessions.delete(token);
   return reply(res,200,{ok:true},{'Set-Cookie':cookie(req,'',0)});
 }
 if(pathname.startsWith('/api/admin/')){
   if(!auth(req,res))return;
   if(method==='GET'&&pathname==='/api/admin/orders')return reply(res,200,{orders:await commerce.adminOrders()});
   if(method==='PATCH'&&pathname.match(/^\/api\/admin\/orders\/[a-f0-9-]{36}$/)){
    const id=pathname.split('/').pop(),data=await readJson(req);
    await commerce.updateOrder(id,data.status);return reply(res,200,{ok:true});
   }
   if(method==='GET'&&pathname==='/api/admin/products')return reply(res,200,await loadProducts());
   if(method==='GET'&&pathname==='/api/admin/reviews')return reply(res,200,cloud.enabled?await cloud.recentReviews(200):(await loadReviews()).slice(0,200));
   if(method==='GET'&&pathname==='/api/admin/reviews/export')return reply(res,200,await loadReviews());
   const reviewMatch=/^\/api\/admin\/reviews\/([a-zA-Z0-9-]+)$/.exec(pathname);
   if(reviewMatch&&method==='DELETE'){
    if(cloud.enabled){await cloud.removeReview(reviewMatch[1]);return reply(res,200,{ok:true})}
    const rows=await loadReviews();const index=rows.findIndex(r=>r.id===reviewMatch[1]);if(index<0)return reply(res,404,{error:'Yorum bulunamadı.'});
    rows.splice(index,1);saveReviews(rows);return reply(res,200,{ok:true});
   }
   if(method==='POST'&&pathname==='/api/admin/products'){
     const form=parseMultipart(await readRaw(req),req.headers['content-type']);
     let data;try{data=JSON.parse(form.fields.payload||'{}');}catch{throw Object.assign(new Error('Form bilgisi okunamadı.'),{status:400});}
     const row=sanitize(data,{id:crypto.randomUUID(),modelUrl:null,format:null,isDemo:true,createdAt:new Date().toISOString()});
     if(form.photos.length>MAX_PHOTOS)throw Object.assign(new Error('En fazla 6 fotoğraf eklenebilir.'),{status:400});
     let upload=null,photoUrls=[];
     try{
      upload=saveUpload(form.file);photoUrls=savePhotos(form.photos);
      row.photos=await promotePhotos(photoUrls);
      if(upload){const preview=await preparePreview(upload);Object.assign(row,await promoteModel(upload,preview),{isDemo:false});}
      if(cloud.enabled){await cloud.upsertProduct(row)}else{const rows=await loadProducts();rows.unshift(row);saveProducts(rows)}
      return reply(res,201,row);
     }catch(err){if(upload)await removeUpload(upload);await Promise.all(photoUrls.map(safeDeleteUrl));await removeUpload(row);throw err}
   }
   const match=/^\/api\/admin\/products\/([a-zA-Z0-9-]+)$/.exec(pathname);
   if(match){const id=match[1];const rows=await loadProducts(),idx=rows.findIndex(p=>p.id===id);
     if(idx<0)return reply(res,404,{error:'Ürün bulunamadı.'});
     if(method==='DELETE'){
       const oldForDelete=rows[idx];
       if(cloud.enabled){await cloud.deleteProduct(id);await cloud.removeReviewsForProduct(id)}
       else{rows.splice(idx,1);saveProducts(rows);const reviews=(await loadReviews()).filter(r=>r.productId!==id);saveReviews(reviews)}
       await removeUpload(oldForDelete);
       return reply(res,200,{ok:true});
     }
     if(method==='PUT'){
       const form=parseMultipart(await readRaw(req),req.headers['content-type']);
       let data;try{data=JSON.parse(form.fields.payload||'{}');}catch{throw Object.assign(new Error('Form bilgisi okunamadı.'),{status:400});}
       const old=rows[idx],cleaned=sanitize(data,old);
       const retained=keepExistingPhotos(data,old);
       if(form.photos.length+retained.length>MAX_PHOTOS)throw Object.assign(new Error('Üründe en fazla 6 fotoğraf bulunabilir.'),{status:400});
       let upload=null,photoUrls=[];
       try{
        upload=saveUpload(form.file);photoUrls=savePhotos(form.photos);
        cleaned.photos=[...retained,...await promotePhotos(photoUrls)];
        if(upload){Object.assign(cleaned,{modelUrl:null,format:null,isDemo:false,previewUrl:null,previewError:null,previewTriangles:null},await promoteModel(upload,await preparePreview(upload)));}
        if(cloud.enabled){await cloud.upsertProduct(cleaned)}else{rows[idx]=cleaned;saveProducts(rows)}
        if(upload){await Promise.all([safeDeleteUrl(old.modelUrl),safeDeleteUrl(old.previewUrl)]);}
        for(const photo of old.photos||[])if(!retained.includes(photo))await safeDeleteUrl(photo);
        return reply(res,200,cleaned);
       }catch(err){if(upload){await removeUpload(upload);if(cleaned.modelUrl!==old.modelUrl)await Promise.all([safeDeleteUrl(cleaned.modelUrl),safeDeleteUrl(cleaned.previewUrl)])}
        await Promise.all(photoUrls.map(safeDeleteUrl));for(const photo of cleaned.photos||[])if(!retained.includes(photo))await safeDeleteUrl(photo);throw err}
     }
   }
   if(method==='GET'&&pathname==='/api/admin/asset'){
     if(!cloud.enabled)return reply(res,409,{error:'Yalnızca Supabase depo yedeği için.'});
     const asset=url.searchParams.get('url')||'';
     // Protect original design files. Download only names referenced by an existing product.
     const rows=await loadProducts();
     if(!rows.some(r=>[r.modelUrl,r.previewUrl,...(r.photos||[])].includes(asset)))return reply(res,404,{error:'Dosya ürünlerde bulunamadı.'});
     if(!cloud.objectRef(asset))return reply(res,400,{error:'Dosya referansı geçersiz.'});
     const content=await cloud.downloadObject(asset);
     res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="threedee-asset"','Cache-Control':'no-store','Content-Length':content.length,'X-Content-Type-Options':'nosniff'});
     return res.end(content);
   }
   // Backup restore is opt-in. Never writes to the old Render filesystem in Supabase mode.
   if(method==='POST'&&pathname==='/api/admin/import-asset'){
     if(!cloud.enabled)return reply(res,409,{error:'Önce Supabase bağlantısını kurun.'});
     const role=String(req.headers['x-threedee-role']||'');
     const ext=String(req.headers['x-threedee-ext']||'').toLowerCase();
     if(!['model','preview','photo'].includes(role)||!/^\.(3mf|stl|glb|jpg|jpeg|png|webp)$/.test(ext))return reply(res,400,{error:'Dosya türü geçersiz.'});
     if(role==='model'&&!['.3mf','.stl','.glb'].includes(ext))return reply(res,400,{error:'Geçersiz model.'});
     if(role==='preview'&&ext!=='.glb')return reply(res,400,{error:'GLB önizlemesi gerekli.'});
     if(role==='photo'&&!['.jpg','.jpeg','.png','.webp'].includes(ext))return reply(res,400,{error:'Geçersiz fotoğraf.'});
     const bytes=await readRaw(req,role==='photo'?MAX_PHOTO:MAX_FILE);
     if(!bytes.length)return reply(res,400,{error:'Boş dosya.'});
     if(ext==='.3mf'&&bytes.subarray(0,2).toString()!=='PK')return reply(res,400,{error:'3MF dosyası geçersiz.'});
     if(ext==='.glb'&&bytes.subarray(0,4).toString()!=='glTF')return reply(res,400,{error:'GLB dosyası geçersiz.'});
     if(['.jpg','.jpeg'].includes(ext)&&!(bytes[0]===255&&bytes[1]===216&&bytes[2]===255))return reply(res,400,{error:'JPG hatalı.'});
     if(ext==='.png'&&!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return reply(res,400,{error:'PNG hatalı.'});
     if(ext==='.webp'&&(bytes.subarray(0,4).toString()!=='RIFF'||bytes.subarray(8,12).toString()!=='WEBP'))return reply(res,400,{error:'WEBP hatalı.'});
     const key=crypto.randomUUID()+ext;
     const url=await cloud.uploadObject(role==='model'?cloud.ORIGINALS:cloud.MEDIA,key,bytes,MIME[ext]);
     return reply(res,201,{url});
   }
   if(method==='POST'&&pathname==='/api/admin/import-data'){
     if(!cloud.enabled)return reply(res,409,{error:'Önce Supabase bağlantısını kurun.'});
     const buf=await readRaw(req,8*1024*1024);let incoming;try{incoming=JSON.parse(buf.toString('utf8'))}catch{return reply(res,400,{error:'JSON bozuk.'})}
     if(!Array.isArray(incoming.products)||!Array.isArray(incoming.reviews)||incoming.products.length>1000||incoming.reviews.length>10000)return reply(res,400,{error:'Yedek ürün veya yorum sınırı aşıldı.'});
     const urlAllowed=u=>u==null||(typeof u==='string'&&(cloud.objectRef(u)!==null));
     const newProducts=incoming.products.map(p=>{
       if(!p||typeof p.id!=='string'||!/^[a-z0-9-]{1,90}$/i.test(p.id)||!urlAllowed(p.modelUrl)||!urlAllowed(p.previewUrl)||!Array.isArray(p.photos||[])||(p.photos||[]).length>MAX_PHOTOS||(p.photos||[]).some(u=>!urlAllowed(u)))throw Object.assign(new Error('Yedek ürün bağlantıları geçersiz.'),{status:400});
       const row=sanitize(p,{...p,id:p.id});row.photos=p.photos||[];return row;
     });
     const newReviews=incoming.reviews.map(r=>{
       if(!r||!/[a-z0-9-]{1,90}/i.test(r.id)||!['museum','product'].includes(r.scope)||!String(r.name||'').trim()||!String(r.message||'').trim())throw Object.assign(new Error('Yedek yorum geçersiz.'),{status:400});
       return {id:r.id,scope:r.scope,productId:r.scope==='product'?r.productId:null,name:String(r.name).slice(0,35),message:String(r.message).slice(0,700),rating:r.scope==='product'?Number(r.rating):null,createdAt:r.createdAt||new Date().toISOString()};
     });
     if(newReviews.some(r=>r.scope==='product'&&(!r.productId||!Number.isInteger(r.rating)||r.rating<1||r.rating>5)))return reply(res,400,{error:'Yorum puanı geçersiz.'});
     for(const product of newProducts)await cloud.upsertProduct(product);
     await cloud.upsertReviews(newReviews);
     return reply(res,200,{ok:true,products:newProducts.length,reviews:newReviews.length});
   }
   return reply(res,404,{error:'Yönetici adresi bulunamadı.'});
 }
 if(method!=='GET')return reply(res,405,{error:'Desteklenmeyen işlem.'});
 if(pathname.startsWith('/uploads/')){
   const name=pathname.slice('/uploads/'.length);
   if(!/^[a-f0-9-]{36}\.(3mf|glb|stl|jpg|jpeg|png|webp)$/i.test(name))return reply(res,404,{error:'Dosya bulunamadı.'});
   return serveFile(res,path.join(UPLOADS,name),true);
 }
 const routes={'/':'index.html','/index.html':'index.html','/admin':'admin.html','/admin.html':'admin.html','/style.css':'style.css','/museum.js':'museum.js','/admin.js':'admin.js','/shop.js':'shop.js','/checkout.js':'checkout.js','/checkout':'checkout.html','/checkout.html':'checkout.html','/favicon.svg':'favicon.svg','/threedee-logo.webp':'threedee-logo.webp','/classical.ogg':'classical.ogg'};
 if(routes[pathname])return serveFile(res,path.join(PUBLIC,routes[pathname]));
 return reply(res,404,{error:'Sayfa bulunamadı.'});
}
const server=http.createServer((req,res)=>{Promise.resolve(handle(req,res)).catch(e=>{
 console.error(e);if(!res.headersSent)reply(res,e.status||500,{error:e.status?e.message:'Sunucu hatası oluştu.'});
});});
server.listen(PORT,'0.0.0.0',()=>{
 if(cloud.enabled){cloud.check().then(()=>console.log('Supabase veritabanına bağlandı.')).catch(err=>{console.error('Supabase bağlantısı başarısız:',err.message);process.exitCode=1;server.close()});}
 else setImmediate(()=>backfillPreviews().catch(err=>console.warn('Önizleme geçişi:',err.message)));
 console.log(`3D Müze: http://localhost:${PORT}`);
 if(!process.env.ADMIN_PASSWORD){console.log('\n=======================================================');console.log('GECICI ADMIN ŞİFRESİ:',PASSWORD);console.log('Kalıcı kullanım için ADMIN_PASSWORD ortam değişkenini ayarlayın.');console.log('=======================================================\n');}
});
