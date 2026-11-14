import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const $ = id => document.getElementById(id);
const money = n => new Intl.NumberFormat('tr-TR',{style:'currency',currency:'TRY',maximumFractionDigits:2}).format(Number(n)||0);
const mobile = matchMedia('(pointer:coarse)').matches;
const colors = { gold: 0xbfa477, dark: 0x212a27, wall: 0x45524d, floor: 0x67675c, cream: 0xd9cdb7 };
// Ürün dosyalarının yalnızca sunucuda küçültülmüş GLB önizlemesini işler.
const models = new Map();
const MAX_VISIBLE_PREVIEWS = mobile ? 2 : 4;
let proximityRefresh = 0;
let products=[], scene, camera, renderer, clock, museumObjects=[], stands=[], colliders=[], nearest=null;
let backZ=-21, galleryLength=42, galleryCenter=0;
let viewerRenderer, viewerScene, viewerCamera, viewerControl, viewerContent, viewerFrame=0, currentProduct=null;
let active=false, modalOpen=false, catalogOpen=false, yaw=0, pitch=0, touchJoy={x:0,y:0}, isMoving=false;
const keys=new Set();
const raycaster = new THREE.Raycaster();
const HANDLED = new Set(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowLeft','ArrowRight','ArrowDown','KeyE','Space']);
let toastTimer;
const material=(color,metalness=.05,roughness=.65)=>new THREE.MeshStandardMaterial({color,metalness,roughness});
function mesh(geo,mat,pos=[0,0,0],parent=null){const m=new THREE.Mesh(geo,mat);m.position.set(...pos);(parent||scene).add(m);return m;}
function box(w,h,d,mat,x,y,z,parent){return mesh(new THREE.BoxGeometry(w,h,d),mat,[x,y,z],parent)}
function cyl(r1,r2,h,mat,x,y,z,parent,sides=24){return mesh(new THREE.CylinderGeometry(r1,r2,h,sides),mat,[x,y,z],parent)}
function ball(r,mat,x,y,z,parent){return mesh(new THREE.SphereGeometry(r,20,14),mat,[x,y,z],parent)}
function torus(r,t,mat,x,y,z,parent){return mesh(new THREE.TorusGeometry(r,t,12,45),mat,[x,y,z],parent)}
function txtCanvas(text,subtitle='',width=1024,height=400,variant='sign'){
 const c=document.createElement('canvas');c.width=width;c.height=height;
 const ctx=c.getContext('2d');ctx.fillStyle=variant==='sign'?'#27332e':'#242c28';ctx.fillRect(0,0,width,height);
 ctx.strokeStyle='#b8a06d';ctx.lineWidth=5;ctx.strokeRect(16,16,width-32,height-32);
 ctx.fillStyle='#dbc8a3';ctx.textAlign='center';
 if(variant==='sign'){
  ctx.font='31px Georgia';ctx.fillText('✦    THE DIGITAL COLLECTION    ✦',width/2,78);
  ctx.font='normal 92px Georgia';ctx.fillText(text,width/2,220);
  ctx.font='24px Arial';ctx.letterSpacing='4px';ctx.fillText(subtitle,width/2,296);
 }else{
  const max=String(text).length>22?34:40;
  ctx.font=`bold ${max}px Arial`;let shown=String(text);if(shown.length>28)shown=shown.slice(0,27)+'…';
  ctx.fillText(shown,width/2,143);
  ctx.font='34px Georgia';ctx.fillText(subtitle,width/2,226);
  ctx.fillStyle='#b8a588';ctx.font='20px Arial';ctx.fillText('SERGİ ÜRÜNÜ   ·   360° İNCELE',width/2,291);
 }
 const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;return t;
}
function surfaceFrame(x,y,z,w,h,rotation,text,subtitle){
 const g=new THREE.Group();g.position.set(x,y,z);g.rotation.y=rotation;scene.add(g);
 const frameMat=material(0xbca273,.67,.35);box(w+.18,h+.18,.12,frameMat,0,0,0,g);
 box(w,h,.13,material(0x26332e),0,0,.08,g);
 const tex=txtCanvas(text,subtitle);const sign=new THREE.Mesh(new THREE.PlaneGeometry(w-.18,h-.18),new THREE.MeshBasicMaterial({map:tex}));sign.position.z=.16;g.add(sign);
}
function setEnvironment(){
 scene=new THREE.Scene();scene.background=new THREE.Color(0x2f3a34);scene.fog=new THREE.Fog(0x2f3a34,22,65);
 const stone=material(colors.floor,0,.9),line=material(0x827e6f,0,.93),wall=material(colors.wall,0,.95),panel=material(0x36443f,0,.91),bronze=material(0xa88d61,.65,.31),plaster=material(0x879084,0,.85);
 box(28,.65,galleryLength,stone,0,-.35,galleryCenter);
 for(let x=-13;x<=13;x+=2.5){box(.018,.008,galleryLength-.4,line,x,.005,galleryCenter)}
 for(let z=backZ+1;z<=20;z+=2.5){box(27.6,.008,.018,line,0,.006,z)}
 for(let k=0;k<3;k++){const x=k===0?-11.9:k===1?0:11.9;box(.13,.025,galleryLength-.6,bronze,x,.017,galleryCenter)}
 box(.7,8.3,galleryLength,wall,-14,4,galleryCenter);box(.7,8.3,galleryLength,wall,14,4,galleryCenter);
 box(28,8.3,.7,wall,0,4,backZ);
 box(10.5,8.3,.7,wall,-8.75,4,21);box(10.5,8.3,.7,wall,8.75,4,21);
 box(7,2.1,.7,wall,0,7.2,21);
 box(28,.22,galleryLength,panel,0,8.65,galleryCenter);
 box(28,.23,1.5,plaster,0,8.25,backZ+.9);
 for (let z=backZ+2;z<=19;z+=6.5) {
   for (const x of [-13.5,13.5]) {
     box(.7,7.7,1.05,plaster,x,3.9,z);
     box(.9,.21,1.25,bronze,x,7.8,z);box(.9,.21,1.25,bronze,x,.37,z);
     box(.82,.12,1.1,bronze,x,5.15,z);
   }
   box(27.5,.22,.17,bronze,0,7.85,z);
 }
 // Ceiling coves and rhythmic lights
 for (let z=backZ+3;z<=16;z+=7){
   box(8,.17,.21,bronze,0,8.25,z);
   for(const x of [-7,0,7]){
     cyl(.24,.29,.1,material(0xf2e3bf,.5,.25),x,8.11,z);
     // Warm ceiling lights are emissive surfaces, avoiding dozens of dynamic lights on phones.
   }
 }
 // Gold-trimmed doorway and central sign
 for(const x of [-3.8,3.8]){box(.45,7.8,.6,bronze,x,3.9,20.58)}
 box(8.1,.33,.65,bronze,0,7.85,20.58);
 surfaceFrame(0,4.2,backZ+.38,8.5,3.1,0,'THREEDEE','TASARIM   ·   MERAK   ·   KOLEKSİYON');
 // Müzede girişin karşısında da aynı marka logosu sergilenir.
 const logoTexture=new THREE.TextureLoader().load('/threedee-logo.webp');logoTexture.colorSpace=THREE.SRGBColorSpace;
 const brandSign=new THREE.Mesh(new THREE.PlaneGeometry(4.35,2.75),new THREE.MeshBasicMaterial({map:logoTexture,transparent:false}));
 brandSign.position.set(0,4.2,backZ+.555);scene.add(brandSign);
 surfaceFrame(-13.51,4.15,1.5,3.9,2.15,Math.PI/2,'YAKINDAN','Her ayrıntıyı keşfet');
 surfaceFrame(13.51,4.15,-6,3.9,2.15,-Math.PI/2,'DÖNDÜR','Üç boyutlu deneyim');
 // Decorative side wall insets
 for(const x of [-13.55,13.55])for(let z=11;z>backZ+2;z-=9){
  const sign=new THREE.Group();sign.position.set(x,2.75,z);sign.rotation.y=x<0?Math.PI/2:-Math.PI/2;scene.add(sign);
  box(3.15,2.9,.11,bronze,0,0,0,sign);box(2.98,2.72,.13,panel,0,0,.06,sign);
  const trim=material(0x89948a,.28,.6);box(2.6,2.45,.03,trim,0,0,.14,sign);
  box(2.52,2.36,.05,panel,0,0,.16,sign);
 }
 // Potted plants near entrance
 for(const x of [-10.7,10.7])for(const z of [backZ+2.0,18.1]){
  cyl(.48,.32,1.1,material(0x5e5546),x,.58,z);
  for(let t=0;t<7;t++){
   const rad=t*6.283/7;const leaf=mesh(new THREE.ConeGeometry(.3,1.8,6),material(t%2?0x54694f:0x6d7860),[x+Math.cos(rad)*.24,1.55+Math.cos(t)*.12,z+Math.sin(rad)*.24]);
   leaf.rotation.z=.16*Math.cos(rad);leaf.rotation.x=.16*Math.sin(rad);
  }
 }
 scene.add(new THREE.HemisphereLight(0xf3e5c8,0x252a28,2.5));
 const dir=new THREE.DirectionalLight(0xffedcf,2.2);dir.position.set(3,12,12);scene.add(dir);
}
const scenePositions=[];
for(let row=0;row<5;row++)for(let side of [-1,1])scenePositions.push({x:side*7.5,z:11.4-row*7.0});
// Positions extend the museum automatically as new products are published.
function positionFor(i){if(i<scenePositions.length)return scenePositions[i];return {x:(i%2?-1:1)*7.5,z:11.4-Math.floor(i/2)*7.0}}
function buildStands(){
 // All published products get their own plinth, including newly uploaded models.
 for(let i=0;i<products.length;i++){
  const p=products[i],pos=positionFor(i);
  const pedestal=new THREE.Group();pedestal.position.set(pos.x,0,pos.z);scene.add(pedestal);
  const base=material(0x989889,.10,.75),top=material(0xc9bea8,.23,.5),gold=material(0xc9a976,.7,.31);
  cyl(1.55,1.65,.28,base,0,.14,0,pedestal,8);
  cyl(1.27,1.41,.90,base,0,.72,0,pedestal,8);
  cyl(1.41,1.36,.09,gold,0,1.18,0,pedestal,8);
  cyl(1.35,1.33,.07,top,0,1.26,0,pedestal,8);
  const glass=new THREE.Mesh(new THREE.CylinderGeometry(1.16,1.16,2.2,32,1,true),new THREE.MeshPhysicalMaterial({color:0xebf6e9,transparent:true,opacity:.045,metalness:.05,roughness:.11,side:THREE.DoubleSide,depthWrite:false}));
  glass.position.y=2.43;pedestal.add(glass);
  const display=new THREE.Group();display.position.y=1.30;pedestal.add(display);
  const labelGroup=new THREE.Group();labelGroup.position.set(0,.68,pos.x<0?1.47:1.47);pedestal.add(labelGroup);
  box(1.82,.73,.08,gold,0,0,0,labelGroup);
  const label=mesh(new THREE.PlaneGeometry(1.75,.68),new THREE.MeshBasicMaterial({map:txtCanvas(p.name,money(p.price),600,380,'item')}),[0,0,.048],labelGroup);
  // Heykeller ilk yüklemede ağır modelleri açmaz. Önce hafif temsili siluet görünür.
  pedestal.userData.productId=p.id;
  const placeholder=normalized(demoModel(p.modelUrl?{...p,shape:'abstract'}:p));
  display.add(placeholder);placeholder.position.y=.04;
  stands.push({p,pos,pedestal,display,placeholder,actual:null,loading:false,failed:false});
  // Telefonda onlarca dinamik Spotlight GPU kullanımını şişiriyordu; statik vurgulara geçildi.
  const glow=material(0xd7ad70,.18,.45);glow.emissive.setHex(0x3f2911);glow.emissiveIntensity=.4;
  const accent=cyl(1.32,1.33,.025,glow,0,1.31,0,pedestal,24);
  colliders.push({x:pos.x,z:pos.z,r:1.45});
 }
}
function demoModel(p){
 const group=new THREE.Group(), color=material(p.color||'#bba78b',.16,.45),alt=material(0xd8cdb8,.15,.56),black=material(0x272b2a,.1,.65),pink=material(0xd5a9a7,.1,.54);
 switch(p.shape){
  case 'figure':
   cyl(.32,.6,1.05,color,0,.55,0,group);ball(.36,alt,0,1.38,0,group);
   ball(.06,black,-.14,1.42,.3,group);ball(.06,black,.14,1.42,.3,group);
   const lip=torus(.13,.035,pink,0,1.22,.32,group);lip.scale.y=.42;
   for(const x of [-.55,.55]){const arm=cyl(.115,.10,.73,color,x,.71,0,group);arm.rotation.z=x>0?.4:-.4}
   for(const x of [-.2,.2])cyl(.13,.13,.4,black,x,-.07,0,group);
   torus(.36,.07,material(0xddb36a,.7,.25),0,1.84,0,group).rotation.x=Math.PI/2;
   break;
  case 'dragon':
   cyl(.55,.73,.32,color,0,.24,0,group);
   const neck=cyl(.23,.4,1.2,color,0,.97,0,group);neck.rotation.z=-.25;
   ball(.41,color,.31,1.7,0,group);
   for(const z of [-.24,.24]){const horn=mesh(new THREE.ConeGeometry(.14,.48,8),alt,[.14,2.05,z],group);horn.rotation.z=-.2}
   const tail=mesh(new THREE.ConeGeometry(.26,1.4,12),color,[-.45,.35,-.33],group);tail.rotation.z=-Math.PI/2.5;
   for(const z of [-.4,.4]){const wing=mesh(new THREE.ConeGeometry(.68,1.45,3),color,[-.5,1.26,z],group);wing.rotation.z=.4}
   break;
  case 'ghost':
   cyl(.58,.74,1.1,alt,0,.63,0,group);ball(.58,alt,0,1.21,0,group);
   ball(.095,black,-.24,1.3,.50,group);ball(.095,black,.24,1.3,.50,group);
   ball(.09,pink,0,1.02,.58,group);
   for(const x of [-.43,0,.43])ball(.24,alt,x,.17,.20,group);
   break;
  case 'holder':
   box(1.8,.19,1.02,black,0,.10,0,group);box(1.8,.9,.15,color,0,.53,-.43,group);
   box(.13,.62,.98,color,-.82,.40,0,group);box(.13,.62,.98,color,.82,.40,0,group);
   for(let i=0;i<4;i++)box(1.3,.54,.065,i%2?alt:material(0x95938d),0,.50,-.27+i*.14,group);
   break;
  case 'ballerina':
   const skirt=mesh(new THREE.ConeGeometry(.95,.97,28),color,[0,.66,0],group);skirt.rotation.z=Math.PI;
   cyl(.19,.17,.68,pink,0,1.30,0,group);ball(.27,alt,0,1.86,0,group);ball(.24,black,0,2.08,-.05,group);
   for(const x of [-.65,.65]){const a=cyl(.07,.07,.83,alt,x*.65,1.55,0,group);a.rotation.z=x>0?1.1:-1.1}
   for(const x of [-.15,.15])cyl(.08,.065,.65,alt,x,.12,0,group);
   break;
  case 'stitch':
   const grid=box(1.75,1.73,.13,alt,0,.92,0,group);grid.rotation.x=-.13;
   const border=material(0x9c8b73);box(1.9,.11,.21,border,0,1.86,0,group);box(1.9,.11,.21,border,0,0,0,group);
   for(const x of [-.91,.91])box(.10,1.9,.22,border,x,.93,0,group);
   const tiles=material(0xe4b871);
   for(let r=-4;r<=4;r++)for(let c=-4;c<=4;c++)if(Math.abs(r)+Math.abs(c)<5){box(.11,.11,.03,(r+c)%3===0?material(0x806d60):tiles,r*.16,.93+c*.16,.11,group)}
   break;
  case 'cat':
   ball(.74,color,0,.9,0,group);for(const x of [-.47,.47]){const ear=mesh(new THREE.ConeGeometry(.33,.58,3),color,[x,1.65,0],group);ear.rotation.z=x<0?.2:-.2}
   for(const x of [-.28,.28])ball(.1,black,x,1.1,.64,group);
   ball(.11,pink,0,.83,.71,group);
   const mouse=ball(.29,alt,.75,.17,.58,group);ball(.13,pink,1,.21,.56,group);
   break;
  default:
   const shape=mesh(new THREE.TorusKnotGeometry(.53,.18,108,14,2,3),color,[0,1.03,0],group);shape.rotation.set(.5,.35,.4);
   cyl(.6,.7,.18,alt,0,.11,0,group);
 }
 return group;
}
function normalized(raw){
 const wrapper=new THREE.Group();wrapper.add(raw);
 raw.updateMatrixWorld(true);const b=new THREE.Box3().setFromObject(raw);const s=new THREE.Vector3();b.getSize(s);
 if(!Number.isFinite(s.x)||Math.max(s.x,s.y,s.z)<1e-7)throw new Error('Model geometrisi boş.');
 const scale=Math.min(2.06/Math.max(s.x,.00001),2.12/Math.max(s.y,.00001),2.06/Math.max(s.z,.00001));
 const mid=b.getCenter(new THREE.Vector3());raw.position.set(-mid.x,-b.min.y,-mid.z);wrapper.scale.setScalar(scale);
 return wrapper;
}
async function loadDisplay(p){
 if(!p.modelUrl)return normalized(demoModel(p));
 // Eski ağır 3MF/STL dosyaları hiçbir zaman istemcide ayrıştırılmaz.
 const url=p.previewUrl || (p.format==='glb' ? p.modelUrl : null);
 if(!url)throw new Error(p.previewError||'3MF/STL için hafif önizleme bulunamadı.');
 const key=p.id+':'+url;
 if(!models.has(key))models.set(key,(async()=>{
  const response=await fetch(url,{cache:'force-cache',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error('Model indirilirken sorun oluştu: '+response.status);
  const len=Number(response.headers.get('Content-Length')||0);
  if(len>7*1024*1024)throw new Error('Bu GLB modeli telefon için çok büyük; optimize model yükle.');
  const data=await response.arrayBuffer();
  if(data.byteLength>7*1024*1024)throw new Error('GLB önizlemesi fazla büyük.');
  const raw=(await new GLTFLoader().parseAsync(data,'')).scene;
  if(!raw)throw new Error('GLB geometrisi okunamadı.');
  if(p.format==='3mf'||p.format==='stl'){
   raw.traverse(o=>{if(o.isMesh&&o.material){const mats=Array.isArray(o.material)?o.material:[o.material];for(const m of mats){if(m.color)m.color.set(p.color||'#bca78e')}}});
  }
  return normalized(raw);
 })());
 try{return (await models.get(key)).clone(true)}catch(e){models.delete(key);throw e;}
}
// Galeri içinde yalnızca yakındaki modeller yüklenir. Uzaklaşınca gölge/siluet geri gelir.
function refreshNearbyModels(dt){
 if(!active||modalOpen||catalogOpen)return;
 proximityRefresh+=dt;if(proximityRefresh<.8)return;proximityRefresh=0;
 const near=stands.filter(s=>s.p.modelUrl&&s.p.previewUrl).map(s=>({s,d:Math.hypot(camera.position.x-s.pos.x,camera.position.z-s.pos.z)})).sort((a,b)=>a.d-b.d);
 const visible=new Set(near.filter(x=>x.d<12).slice(0,MAX_VISIBLE_PREVIEWS).map(x=>x.s));
 for(const stand of stands){
  if(!stand.p.modelUrl)continue;
  if(!visible.has(stand)){
   if(stand.actual){stand.display.remove(stand.actual);stand.actual=null;stand.display.add(stand.placeholder)}
   continue;
  }
  if(stand.actual||stand.loading||stand.failed)continue;
  stand.loading=true;
  loadDisplay(stand.p).then(obj=>{
   if(!visible.has(stand)||!stand.pedestal.parent)return;
   stand.display.remove(stand.placeholder);obj.position.y=.04;stand.display.add(obj);stand.actual=obj;
  }).catch(err=>{stand.failed=true;console.warn('Yakın sergi önizlemesi:',stand.p.name,err.message)}).finally(()=>{stand.loading=false});
 }
}

function showToast(message){const el=$('toast');el.textContent=message;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),3500)}
async function getProducts(){const r=await fetch('/api/products',{cache:'no-store'});if(!r.ok)throw new Error('Ürünler alınamadı.');return r.json()}
function renderCatalog(){
 const list=$('catalogList');list.replaceChildren();if(!products.length){list.textContent='Henüz sergide ürün yok.';return}
 const icons={figure:'♛',dragon:'♜',ghost:'◉',holder:'▣',ballerina:'✦',stitch:'▦',cat:'♧',abstract:'◈'};
 products.forEach((p,i)=>{
  const btn=document.createElement('button');btn.className='catalog-row';btn.type='button';
  const number=document.createElement('span');number.className='catalog-number';number.textContent=String(i+1).padStart(2,'0');
  const swatch=document.createElement('span');swatch.className='catalog-swatch';swatch.style.color=p.color;swatch.textContent=icons[p.shape]||'◈';
  const data=document.createElement('span');data.className='catalog-data';
  const strong=document.createElement('strong');strong.textContent=p.name;
  const small=document.createElement('small');small.textContent=`${money(p.price)}  ·  ${p.isDemo?'ÖRNEK MODEL':'3D MODEL'}`;
  const arrow=document.createElement('span');arrow.className='catalog-arrow';arrow.textContent='↗';data.append(strong,small);btn.append(number,swatch,data,arrow);btn.addEventListener('click',()=>openProduct(p));list.append(btn);
 });
}
function setShade(){const show=catalogOpen||modalOpen;$('shade').hidden=!show;}
function openCatalog(){if(modalOpen)return;catalogOpen=true;$('catalogDrawer').classList.add('open');$('catalogDrawer').setAttribute('aria-hidden','false');setShade()}
function closeCatalog(){catalogOpen=false;$('catalogDrawer').classList.remove('open');$('catalogDrawer').setAttribute('aria-hidden','true');setShade()}
function fitViewer(){if(!viewerRenderer||!$('productViewer').clientWidth)return;const el=$('productViewer');const w=el.clientWidth,h=el.clientHeight;viewerRenderer.setSize(w,h,false);viewerCamera.aspect=w/h;viewerCamera.updateProjectionMatrix()}
function initViewer(){
 const el=$('productViewer');viewerScene=new THREE.Scene();viewerScene.background=new THREE.Color(0xd9d8c9);
 viewerCamera=new THREE.PerspectiveCamera(39,1,.05,100);viewerCamera.position.set(3.6,2.6,4.6);
 viewerRenderer=new THREE.WebGLRenderer({alpha:false,antialias:true,powerPreference:'default'});
 viewerRenderer.setPixelRatio(Math.min(window.devicePixelRatio,mobile?1.05:1.4));viewerRenderer.outputColorSpace=THREE.SRGBColorSpace;
 viewerRenderer.toneMapping=THREE.ACESFilmicToneMapping;viewerRenderer.toneMappingExposure=1.65;
 el.append(viewerRenderer.domElement);
 viewerControl=new OrbitControls(viewerCamera,viewerRenderer.domElement);
 viewerControl.target.set(0,1,0);viewerControl.enableDamping=true;viewerControl.dampingFactor=.06;
 viewerControl.minDistance=2.3;viewerControl.maxDistance=9;viewerControl.maxPolarAngle=Math.PI*.83;
 viewerContent=new THREE.Group();viewerScene.add(viewerContent);
 viewerScene.add(new THREE.HemisphereLight(0xffffff,0x7c796a,3.0));
 const l=new THREE.DirectionalLight(0xffffff,3.1);l.position.set(3,7,5);viewerScene.add(l);
 const l2=new THREE.DirectionalLight(0xffe0ae,1.8);l2.position.set(-4,3,-4);viewerScene.add(l2);
 const stage=cyl(.98,1.1,.22,material(0xb3a187,.18,.5),0,.13,0,viewerScene,44);
 const ring=cyl(1.03,1.02,.06,material(0xc9aa6e,.7,.25),0,.24,0,viewerScene,44);
 fitViewer();
 const loop=()=>{viewerFrame=requestAnimationFrame(loop);if(!modalOpen)return;viewerControl.update();viewerRenderer.render(viewerScene,viewerCamera)};loop();
}
let loadTicket=0;
async function openProduct(p){
 if(!p)return;
 closeCatalog();modalOpen=true;currentProduct=p;setShade();
 $('productModal').classList.add('open');$('productModal').setAttribute('aria-hidden','false');
 $('productIndex').textContent=String(products.findIndex(x=>x.id===p.id)+1).padStart(2,'0');
 $('productName').textContent=p.name;$('productPrice').textContent=money(p.price);$('productDescription').textContent=p.description||'Bu ürün için henüz açıklama eklenmedi.';
 $('productStock').textContent=p.stock?`Stokta ${p.stock} adet mevcut`:'Şu an stokta yok';$('stockDot').classList.toggle('empty',!p.stock);
 $('productFormat').textContent=p.format?.toUpperCase()||'Temsili 3D model';$('sampleNote').hidden=!p.isDemo;
 if(!viewerRenderer)initViewer();
 viewerContent.clear();viewerCamera.position.set(3.6,2.6,4.6);viewerControl.target.set(0,1,0);viewerControl.update();
 $('viewerLoading').hidden=false;$('viewerLoading').textContent=p.previewError?'Önizleme hazırlanamadı. Temsili model gösterilecek.':'Model yükleniyor…';
 setTimeout(fitViewer,60);const ticket=++loadTicket;
 try{const obj=await loadDisplay(p);if(ticket!==loadTicket)return;obj.position.y=.31;viewerContent.add(obj);$('viewerLoading').hidden=true;}
 catch(err){console.warn(err);if(ticket!==loadTicket)return;viewerContent.add(normalized(demoModel({...p,shape:'abstract'})));$('viewerLoading').textContent='Model açılmadı, temsili görünüm gösteriliyor.';}
}
function closeProduct(){loadTicket++;modalOpen=false;currentProduct=null;$('productModal').classList.remove('open');$('productModal').setAttribute('aria-hidden','true');setShade()}
function resetCamera(){camera.position.set(0,1.68,17);yaw=0;pitch=-.04;camera.rotation.set(pitch,yaw,0,'YXZ')}
function allowed(x,z){
 if(x<-11.85||x>11.85||z<backZ+2.2||z>18.6)return false;
 for(const o of colliders)if(Math.hypot(x-o.x,z-o.z)<o.r+0.38)return false;
 return true;
}
function navigate(dt){
 if(!active||catalogOpen||modalOpen)return;
 const forward=Number(keys.has('KeyW')||keys.has('ArrowUp'))-Number(keys.has('KeyS')||keys.has('ArrowDown'))-touchJoy.y;
 const side=Number(keys.has('KeyD')||keys.has('ArrowRight'))-Number(keys.has('KeyA')||keys.has('ArrowLeft'))+touchJoy.x;
 let f=forward,s=side;const len=Math.hypot(f,s);if(len<.04){isMoving=false;return}isMoving=true;
 f/=Math.max(len,1);s/=Math.max(len,1);
 const speed=mobile?3.65:4.6;
 const dx=(Math.sin(yaw)*f + Math.cos(yaw)*s)*speed*Math.min(dt,.045);
 const dz=(-Math.cos(yaw)*f + Math.sin(yaw)*s)*speed*Math.min(dt,.045);
 if(allowed(camera.position.x+dx,camera.position.z))camera.position.x+=dx;
 if(allowed(camera.position.x,camera.position.z+dz))camera.position.z+=dz;
}
let proximityMs=0;
function updateProximity(dt){
 proximityMs+=dt;if(proximityMs<.18)return;proximityMs=0;
 nearest=null;let best=Infinity;
 for(const s of stands){const dist=Math.hypot(camera.position.x-s.pos.x,camera.position.z-s.pos.z);
   if(dist<best){best=dist;nearest=s.p;}
 }
 const near=best<4.6;
 $('hintText').textContent=near&&nearest?`${nearest.name} · E / İncele`:'Bir esere yaklaşarak inceleyebilirsin.';
 $('interactMobile').disabled=!near;$('interactMobile').textContent=near?'✦  Ürünü incele':'✦  Yaklaş ve incele';
 if(!near)nearest=null;
}
function setupWalk(){
 const c=renderer.domElement;let pointer=null;
 c.addEventListener('pointerdown',e=>{if(!active||modalOpen||catalogOpen)return;
  if(e.button!==0 && e.pointerType==='mouse')return;
  pointer={id:e.pointerId,x:e.clientX,y:e.clientY,total:0,prevX:e.clientX,prevY:e.clientY};c.setPointerCapture(e.pointerId);
 });
 c.addEventListener('pointermove',e=>{if(!pointer||pointer.id!==e.pointerId||modalOpen||catalogOpen)return;
  const dx=e.clientX-pointer.prevX,dy=e.clientY-pointer.prevY;
  pointer.total+=Math.hypot(dx,dy);pointer.prevX=e.clientX;pointer.prevY=e.clientY;
  yaw+=dx*.0042;pitch=Math.max(-.75,Math.min(.78,pitch-dy*.0035));
 });
 c.addEventListener('pointerup',e=>{
  if(!pointer||pointer.id!==e.pointerId)return;
  const p=pointer;pointer=null;if(p.total>12)return;
  const mouse=new THREE.Vector2(e.clientX/innerWidth*2-1,-(e.clientY/innerHeight)*2+1);
  raycaster.setFromCamera(mouse,camera);
  const matches=raycaster.intersectObjects(stands.map(s=>s.pedestal),true);
  let hit=matches[0]?.object;while(hit&&!hit.userData.productId)hit=hit.parent;
  const id=hit?.userData?.productId;
  if(id)openProduct(products.find(x=>x.id===id));
 });
 c.addEventListener('pointercancel',()=>pointer=null);
 window.addEventListener('keydown',e=>{if(HANDLED.has(e.code))e.preventDefault();keys.add(e.code);
  if(e.code==='KeyE'&&!modalOpen&&active){if(nearest)openProduct(nearest);else showToast('İncelemek için bir ürüne yaklaş.');}
  if(e.code==='Escape'){if(modalOpen)closeProduct();else if(catalogOpen)closeCatalog();}
 });
 window.addEventListener('keyup',e=>keys.delete(e.code));window.addEventListener('blur',()=>keys.clear());
 // Independent touch joystick with normalized displacement
 const j=$('joystick'),knob=$('joyKnob');let stickId=null;
 function joy(e){const r=j.querySelector('.joystick-ring').getBoundingClientRect();const cx=r.left+r.width/2,cy=r.top+r.height/2;
  const x=(e.clientX-cx)/39,y=(e.clientY-cy)/39,div=Math.max(1,Math.hypot(x,y));
  touchJoy.x=x/div;touchJoy.y=y/div;knob.style.transform=`translate(${touchJoy.x*34}px,${touchJoy.y*34}px)`;
 }
 j.addEventListener('pointerdown',e=>{if(!active)return;stickId=e.pointerId;j.setPointerCapture(e.pointerId);joy(e);e.preventDefault()});
 j.addEventListener('pointermove',e=>{if(e.pointerId===stickId)joy(e)});
 function endJoy(e){if(stickId!==e.pointerId)return;stickId=null;touchJoy={x:0,y:0};knob.style.transform='';}
 j.addEventListener('pointerup',endJoy);j.addEventListener('pointercancel',endJoy);
}
function animate(){
 requestAnimationFrame(animate);const dt=clock.getDelta();navigate(dt);
 camera.rotation.set(pitch,yaw,0,'YXZ');updateProximity(dt);refreshNearbyModels(dt);
 if(active&&!modalOpen&&!catalogOpen){
  // Museums are still exhibitions; moving sculptures rotate slowly, not fast spinning displays.
  for(const stand of stands)stand.display.rotation.y+=dt*.16;
 }
 if(!modalOpen&&!catalogOpen)renderer.render(scene,camera);
}
async function init(){
 try{
  renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'default'});
  renderer.setPixelRatio(Math.min(devicePixelRatio,mobile?1.05:1.5));renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.7;
  renderer.setSize(innerWidth,innerHeight);$('museumCanvas').append(renderer.domElement);
  clock=new THREE.Clock();camera=new THREE.PerspectiveCamera(mobile?75:68,innerWidth/innerHeight,.12,100);
  products=await getProducts();
  const lastZ=11.4-(Math.max(1,Math.ceil(products.length/2))-1)*7;
  backZ=Math.min(-21,lastZ-5);galleryLength=21-backZ;galleryCenter=(21+backZ)/2;
  setEnvironment();resetCamera();buildStands();renderCatalog();setupWalk();animate();
  $('loadingScreen').remove();
  window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);fitViewer()});
 }catch(e){console.error(e);$('loadingScreen').innerHTML='<div>3D müze açılamadı.</div><div style="font:12px Arial;color:#c6ad8e;letter-spacing:0">Tarayıcında WebGL desteğini ve internet bağlantını kontrol et.</div>'}
}
const bgMusic=$('classicalAmbience'),musicButton=$('toggleMusic');
bgMusic.volume=.21;
let musicEnabled=true;
function updateMusicButton(){musicButton.textContent=musicEnabled?'♫ Müzik açık':'♪ Müzik kapalı';musicButton.setAttribute('aria-pressed',String(musicEnabled));}
async function tryPlayMusic(){if(!musicEnabled)return;try{await bgMusic.play();}catch(e){console.warn('Müzik kullanıcı izni bekliyor:',e.message);}}
musicButton.addEventListener('click',()=>{musicEnabled=!musicEnabled;updateMusicButton();if(musicEnabled)tryPlayMusic();else bgMusic.pause()});
updateMusicButton();
$('enterMuseum').addEventListener('click',()=>{$('welcome').hidden=true;active=true;tryPlayMusic();showToast(mobile?'Sol çubukla yürü, sağ tarafta sürükleyerek bak.':'WASD ile yürü, sürükleyerek çevrene bak.');});
$('openCatalog').addEventListener('click',openCatalog);$('closeCatalog').addEventListener('click',closeCatalog);
$('shade').addEventListener('click',()=>{closeCatalog();closeProduct()});
$('closeProduct').addEventListener('click',closeProduct);$('closeProduct2').addEventListener('click',closeProduct);
$('resetPosition').addEventListener('click',resetCamera);$('interactMobile').addEventListener('click',()=>nearest&&openProduct(nearest));
$('fullScreen').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen()}catch{showToast('Tarayıcı tam ekranı desteklemiyor.')}});
init();
