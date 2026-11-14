'use strict';
// 3D Müze | dependencies-free Node.js backend (Node 20+)
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'storage'));
const UPLOADS = path.join(DATA, 'uploads');
const DB = path.join(DATA, 'products.json');
const PORT = Number(process.env.PORT || 3000);
const MAX_FILE = 32 * 1024 * 1024;
const MAX_BODY = MAX_FILE + 1024 * 1024;
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
function loadProducts() {
  try { const x=JSON.parse(fs.readFileSync(DB,'utf8')); return Array.isArray(x) ? x : []; }
  catch (e) { console.error('Ürün verisi okunamadı:',e.message); return []; }
}
function saveProducts(rows) {
  const tmp = DB + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(rows, null, 2)); fs.renameSync(tmp, DB);
}
const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.svg':'image/svg+xml', '.3mf':'model/3mf', '.glb':'model/gltf-binary', '.stl':'model/stl' };
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
  const out={fields:{},file:null}; let pos=buf.indexOf(boundary);
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
  const name=crypto.randomUUID()+ext;fs.writeFileSync(path.join(UPLOADS,name),file.buffer,{flag:'wx'});
  return {modelUrl:'/uploads/'+name,format:ext.slice(1)};
}
function removeUpload(product){
 if(product?.modelUrl?.startsWith('/uploads/')){const name=path.basename(product.modelUrl);try{fs.unlinkSync(path.join(UPLOADS,name));}catch{}}
}
function validOrigin(req){
 const o=req.headers.origin;if(!o)return true;
 try{return new URL(o).host===req.headers.host;}catch{return false;}
}
async function handle(req,res){
 const method=req.method || 'GET';const url=new URL(req.url,'http://localhost');const pathname=url.pathname;
 if(['POST','PUT','PATCH','DELETE'].includes(method) && !validOrigin(req))return reply(res,403,{error:'İsteğe izin verilmedi.'});
 if(method==='GET'&&pathname==='/api/health')return reply(res,200,{status:'ok'});
 if(method==='GET'&&pathname==='/api/products')return reply(res,200,loadProducts().filter(p=>p.active));
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
   if(method==='POST'&&pathname==='/api/admin/products'){
     const form=parseMultipart(await readRaw(req), req.headers['content-type']);
     let data;try{data=JSON.parse(form.fields.payload||'{}');}catch{throw Object.assign(new Error('Form bilgisi okunamadı.'),{status:400});}
     const upload=saveUpload(form.file);let row;
     try{row=sanitize(data,{id:crypto.randomUUID(),modelUrl:upload?.modelUrl||null,format:upload?.format||null,isDemo:!upload,createdAt:new Date().toISOString()});}
     catch(err){if(upload)removeUpload(upload);throw err;}
     const rows=loadProducts();rows.unshift(row);saveProducts(rows);return reply(res,201,row);
   }
   const match=/^\/api\/admin\/products\/([a-zA-Z0-9-]+)$/.exec(pathname);
   if(match){const id=match[1];const rows=loadProducts(),idx=rows.findIndex(p=>p.id===id);
     if(idx<0)return reply(res,404,{error:'Ürün bulunamadı.'});
     if(method==='DELETE'){removeUpload(rows[idx]);rows.splice(idx,1);saveProducts(rows);return reply(res,200,{ok:true});}
     if(method==='PUT'){
       const form=parseMultipart(await readRaw(req),req.headers['content-type']);
       let data;try{data=JSON.parse(form.fields.payload||'{}');}catch{throw Object.assign(new Error('Form bilgisi okunamadı.'),{status:400});}
       const cleaned=sanitize(data,rows[idx]);
       const upload=saveUpload(form.file);
       if(upload){const old=rows[idx];Object.assign(cleaned,upload,{isDemo:false});rows[idx]=cleaned;saveProducts(rows);removeUpload(old);}
       else{rows[idx]=cleaned;saveProducts(rows);}
       return reply(res,200,rows[idx]);
     }
   }
   return reply(res,404,{error:'Yönetici adresi bulunamadı.'});
 }
 if(method!=='GET')return reply(res,405,{error:'Desteklenmeyen işlem.'});
 if(pathname.startsWith('/uploads/')){
   const name=pathname.slice('/uploads/'.length);
   if(!/^[a-f0-9-]{36}\.(3mf|glb|stl)$/i.test(name))return reply(res,404,{error:'Dosya bulunamadı.'});
   return serveFile(res,path.join(UPLOADS,name),true);
 }
 const routes={'/':'index.html','/index.html':'index.html','/admin':'admin.html','/admin.html':'admin.html','/style.css':'style.css','/museum.js':'museum.js','/admin.js':'admin.js','/favicon.svg':'favicon.svg'};
 if(routes[pathname])return serveFile(res,path.join(PUBLIC,routes[pathname]));
 return reply(res,404,{error:'Sayfa bulunamadı.'});
}
const server=http.createServer((req,res)=>{Promise.resolve(handle(req,res)).catch(e=>{
 console.error(e);if(!res.headersSent)reply(res,e.status||500,{error:e.status?e.message:'Sunucu hatası oluştu.'});
});});
server.listen(PORT,'0.0.0.0',()=>{
 console.log(`3D Müze: http://localhost:${PORT}`);
 if(!process.env.ADMIN_PASSWORD){console.log('\n=======================================================');console.log('GECICI ADMIN ŞİFRESİ:',PASSWORD);console.log('Kalıcı kullanım için ADMIN_PASSWORD ortam değişkenini ayarlayın.');console.log('=======================================================\n');}
});
