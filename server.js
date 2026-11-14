'use strict';
// 3D Müze | dependencies-free Node.js backend (Node 20+)
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Worker } = require('node:worker_threads');

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
function loadProducts() {
  try { const x=JSON.parse(fs.readFileSync(DB,'utf8')); return Array.isArray(x) ? x : []; }
  catch (e) { console.error('Ürün verisi okunamadı:',e.message); return []; }
}
function saveProducts(rows) {
  const tmp = DB + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(rows, null, 2)); fs.renameSync(tmp, DB);
}
function loadReviews(){
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
function addReview(req,scope,productId,data){
 if(data.website) return {ok:true}; // Görünmez spam alanı
 const name=String(data.name||'').trim().replace(/\s+/g,' ').slice(0,35);
 const message=String(data.message||'').trim().slice(0,700);
 if(name.length<2||message.length<3||String(data.name||'').length>80||String(data.message||'').length>1000)throw Object.assign(new Error('Ad (2–35) ve yorum (3–700 karakter) gerekli.'),{status:400});
 if(/https?:\/\/|www\./i.test(message))throw Object.assign(new Error('Yorumlarda bağlantı paylaşılamaz.'),{status:400});
 let rating=null;if(scope==='product'){rating=Number(data.rating);if(!Number.isInteger(rating)||rating<1||rating>5)throw Object.assign(new Error('1–5 yıldız arasında puan seç.'),{status:400})}
 checkReviewRate(req,scope,productId);
 const rows=loadReviews();if(rows.length>=10000)throw Object.assign(new Error('Yorum defteri dolu; yöneticiye haber ver.'),{status:507});
 const review={id:crypto.randomUUID(),scope,productId:productId||null,name,message,rating,createdAt:new Date().toISOString()};rows.unshift(review);saveReviews(rows);return {ok:true,review};
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
function safeDeleteUrl(url){
 if(typeof url==='string' && /^\/uploads\/[a-f0-9-]{36}\.(3mf|glb|stl|jpg|jpeg|png|webp)$/i.test(url)){
  try{fs.unlinkSync(path.join(UPLOADS,path.basename(url)))}catch{}
 }
}
function removeUpload(product){safeDeleteUrl(product?.modelUrl);safeDeleteUrl(product?.previewUrl);for(const url of product?.photos||[])safeDeleteUrl(url);}
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
 const rows=loadProducts();
 for(const original of rows){
  if(!original.modelUrl || original.previewUrl || original.previewError || !['3mf','stl'].includes(original.format))continue;
  if(!fs.existsSync(path.join(UPLOADS,path.basename(original.modelUrl))))continue;
  const prepared=await preparePreview({...original,size:fs.statSync(path.join(UPLOADS,path.basename(original.modelUrl))).size});
  const fresh=loadProducts(),index=fresh.findIndex(p=>p.id===original.id);
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
 if(method==='GET'&&pathname==='/api/health')return reply(res,200,{status:'ok'});
 if(method==='GET'&&pathname==='/api/products'){
  const reviews=loadReviews();return reply(res,200,loadProducts().filter(p=>p.active).map(p=>({...p,photos:p.photos||[],rating:ratingSummary(p.id,reviews)})));
 }
 if(pathname==='/api/guestbook' && method==='GET')return reply(res,200,pagedReviews(loadReviews().filter(r=>r.scope==='museum'),url));
 if(pathname==='/api/guestbook' && method==='POST')return reply(res,201,addReview(req,'museum',null,await readJson(req)));
 const publicReview=/^\/api\/products\/([a-zA-Z0-9-]+)\/reviews$/.exec(pathname);
 if(publicReview&&(method==='GET'||method==='POST')){
  const product=loadProducts().find(p=>p.id===publicReview[1]&&p.active);
  if(!product)return reply(res,404,{error:'Ürün bulunamadı.'});
  if(method==='POST')return reply(res,201,addReview(req,'product',product.id,await readJson(req)));
  const reviews=loadReviews();return reply(res,200,{...pagedReviews(reviews.filter(r=>r.scope==='product'&&r.productId===product.id),url),rating:ratingSummary(product.id,reviews)});
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
   if(method==='GET'&&pathname==='/api/admin/products')return reply(res,200,loadProducts());
   if(method==='GET'&&pathname==='/api/admin/reviews')return reply(res,200,loadReviews().slice(0,200));
   const reviewMatch=/^\/api\/admin\/reviews\/([a-zA-Z0-9-]+)$/.exec(pathname);
   if(reviewMatch&&method==='DELETE'){
    const rows=loadReviews();const index=rows.findIndex(r=>r.id===reviewMatch[1]);if(index<0)return reply(res,404,{error:'Yorum bulunamadı.'});
    rows.splice(index,1);saveReviews(rows);return reply(res,200,{ok:true});
   }
   if(method==='POST'&&pathname==='/api/admin/products'){
     const form=parseMultipart(await readRaw(req),req.headers['content-type']);
     let data;try{data=JSON.parse(form.fields.payload||'{}');}catch{throw Object.assign(new Error('Form bilgisi okunamadı.'),{status:400});}
     const row=sanitize(data,{id:crypto.randomUUID(),modelUrl:null,format:null,isDemo:true,createdAt:new Date().toISOString()});
     if(form.photos.length>MAX_PHOTOS)throw Object.assign(new Error('En fazla 6 fotoğraf eklenebilir.'),{status:400});
     let upload=null,photoUrls=[];
     try{
      upload=saveUpload(form.file);photoUrls=savePhotos(form.photos);row.photos=photoUrls;
      if(upload){Object.assign(row,{modelUrl:upload.modelUrl,format:upload.format,isDemo:false},await preparePreview(upload));}
      const rows=loadProducts();rows.unshift(row);saveProducts(rows);return reply(res,201,row);
     }catch(err){if(upload)removeUpload(upload);photoUrls.forEach(safeDeleteUrl);throw err}
   }
   const match=/^\/api\/admin\/products\/([a-zA-Z0-9-]+)$/.exec(pathname);
   if(match){const id=match[1];const rows=loadProducts(),idx=rows.findIndex(p=>p.id===id);
     if(idx<0)return reply(res,404,{error:'Ürün bulunamadı.'});
     if(method==='DELETE'){
       removeUpload(rows[idx]);rows.splice(idx,1);saveProducts(rows);
       const reviews=loadReviews().filter(r=>r.productId!==id);saveReviews(reviews);
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
        cleaned.photos=[...retained,...photoUrls];
        if(upload){Object.assign(cleaned,{modelUrl:upload.modelUrl,format:upload.format,isDemo:false,previewUrl:null,previewError:null,previewTriangles:null},await preparePreview(upload));}
        rows[idx]=cleaned;saveProducts(rows);
        if(upload){safeDeleteUrl(old.modelUrl);safeDeleteUrl(old.previewUrl)}
        for(const photo of old.photos||[])if(!retained.includes(photo))safeDeleteUrl(photo);
        return reply(res,200,cleaned);
       }catch(err){if(upload)removeUpload(upload);photoUrls.forEach(safeDeleteUrl);throw err}
     }
   }
   return reply(res,404,{error:'Yönetici adresi bulunamadı.'});
 }
 if(method!=='GET')return reply(res,405,{error:'Desteklenmeyen işlem.'});
 if(pathname.startsWith('/uploads/')){
   const name=pathname.slice('/uploads/'.length);
   if(!/^[a-f0-9-]{36}\.(3mf|glb|stl|jpg|jpeg|png|webp)$/i.test(name))return reply(res,404,{error:'Dosya bulunamadı.'});
   return serveFile(res,path.join(UPLOADS,name),true);
 }
 const routes={'/':'index.html','/index.html':'index.html','/admin':'admin.html','/admin.html':'admin.html','/style.css':'style.css','/museum.js':'museum.js','/admin.js':'admin.js','/favicon.svg':'favicon.svg','/threedee-logo.webp':'threedee-logo.webp','/classical.ogg':'classical.ogg'};
 if(routes[pathname])return serveFile(res,path.join(PUBLIC,routes[pathname]));
 return reply(res,404,{error:'Sayfa bulunamadı.'});
}
const server=http.createServer((req,res)=>{Promise.resolve(handle(req,res)).catch(e=>{
 console.error(e);if(!res.headersSent)reply(res,e.status||500,{error:e.status?e.message:'Sunucu hatası oluştu.'});
});});
server.listen(PORT,'0.0.0.0',()=>{
 setImmediate(()=>backfillPreviews().catch(err=>console.warn('Önizleme geçişi:',err.message)));
 console.log(`3D Müze: http://localhost:${PORT}`);
 if(!process.env.ADMIN_PASSWORD){console.log('\n=======================================================');console.log('GECICI ADMIN ŞİFRESİ:',PASSWORD);console.log('Kalıcı kullanım için ADMIN_PASSWORD ortam değişkenini ayarlayın.');console.log('=======================================================\n');}
});
