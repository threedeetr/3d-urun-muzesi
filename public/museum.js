import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { initShop, setShopProduct } from './shop.js';

const $ = id => document.getElementById(id);
const money = n => new Intl.NumberFormat('tr-TR',{style:'currency',currency:'TRY',maximumFractionDigits:2}).format(Number(n)||0);
const mobile = matchMedia('(pointer:coarse)').matches;
// ThreeDee HD: gerçek ekran piksel yoğunluğu ve güvenli GPU piksel bütçesi.
// Seçim kullanıcı cihazında kalır; Supabase/hesap verisine dokunulmaz.
const GRAPHICS_KEY='threedee_graphics_quality';
const GRAPHICS_PRESETS={
 balanced:{name:'Dengeli',tag:'◇ Dengeli',dpr:1.2,maxPixels:mobile?1100000:1700000},
 hd:{name:'HD',tag:'◆ HD',dpr:mobile?1.9:2,maxPixels:mobile?2600000:3600000},
 ultra:{name:'Ultra HD',tag:'◆ Ultra',dpr:mobile?2.5:2.6,maxPixels:mobile?4000000:5600000}
};
let graphicsQuality='hd';
try{const value=localStorage.getItem(GRAPHICS_KEY);if(GRAPHICS_PRESETS[value])graphicsQuality=value;}catch{}
function renderDpr(viewer=false){
 const q=GRAPHICS_PRESETS[graphicsQuality];
 const elem=viewer?$('productViewer'):null;
 const w=Math.max(1,viewer?(elem?.clientWidth||480):innerWidth),h=Math.max(1,viewer?(elem?.clientHeight||360):innerHeight);
 const nativeDpr=Math.max(1,window.devicePixelRatio||1);
 // Masaüstü 1× ekranlarda bir miktar supersampling; mobilde donanım DPR sınırı.
 const nativeCap=mobile?nativeDpr:Math.max(nativeDpr,1.4);
 return Math.max(1,Math.min(nativeCap,q.dpr,Math.sqrt(q.maxPixels/(w*h))));
}
function refreshQualityButton(){
 const b=$('graphicsQuality');if(!b)return;
 const preset=GRAPHICS_PRESETS[graphicsQuality];
 b.textContent=preset.tag;b.dataset.quality=graphicsQuality;
 b.title=`Görüntü kalitesi: ${preset.name}. Değiştirmek için dokun.`;
 b.setAttribute('aria-label',b.title);
}
function applyGraphicsQuality(){
 if(renderer){renderer.setPixelRatio(renderDpr());renderer.setSize(innerWidth,innerHeight);}
 if(viewerRenderer){viewerRenderer.setPixelRatio(renderDpr(true));fitViewer();}
 refreshQualityButton();
}

const colors = { gold: 0xc9ae7a, dark: 0x182326, wall: 0x34434a, floor: 0x888d8c, cream: 0xe7e9e4 };
const ART_SHAPES = new Set(['figure','ghost','stitch','ballerina','cat']);
const roomOf = product => ART_SHAPES.has(product.shape) ? 'art' : 'design';
// Ürün dosyalarının yalnızca sunucuda küçültülmüş GLB önizlemesini işler.
const models = new Map();
const MAX_VISIBLE_PREVIEWS = mobile ? 2 : 4;
let proximityRefresh = 0;
let products=[], scene, camera, renderer, clock, museumObjects=[], stands=[], colliders=[], nearest=null, nearestGuestbook=false, guestbookStand=null, receptionStand=null;
let backZ=-21, galleryLength=42, galleryCenter=0;
let roomOpen=false, lastRoom="", drawAccumulator=0;
let viewerRenderer, viewerScene, viewerCamera, viewerControl, viewerContent, viewerFrame=0, currentProduct=null;
let active=false, modalOpen=false, catalogOpen=false, guestbookOpen=false, yaw=0, pitch=0, touchJoy={x:0,y:0}, isMoving=false;
let reviewPage=1,bookPage=1,chosenRating=0,photoIndex=0,photoMode=false,reviewTicket=0,guestTicket=0;
const keys=new Set();
const raycaster = new THREE.Raycaster();
const HANDLED = new Set(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowLeft','ArrowRight','ArrowDown','KeyE','KeyM','Space']);
let toastTimer;
const material=(color,metalness=.05,roughness=.65)=>new THREE.MeshStandardMaterial({color,metalness,roughness});
function mesh(geo,mat,pos=[0,0,0],parent=null){const m=new THREE.Mesh(geo,mat);m.position.set(...pos);(parent||scene).add(m);return m;}
function box(w,h,d,mat,x,y,z,parent){return mesh(new THREE.BoxGeometry(w,h,d),mat,[x,y,z],parent)}
function cyl(r1,r2,h,mat,x,y,z,parent,sides=24){return mesh(new THREE.CylinderGeometry(r1,r2,h,sides),mat,[x,y,z],parent)}
function ball(r,mat,x,y,z,parent){return mesh(new THREE.SphereGeometry(r,20,14),mat,[x,y,z],parent)}
function torus(r,t,mat,x,y,z,parent){return mesh(new THREE.TorusGeometry(r,t,12,45),mat,[x,y,z],parent)}
function txtCanvas(text,subtitle='',width=1024,height=400,variant='sign'){
 // Yüksek çözünürlüklü tipografi: orijinal ölçülerde çizip dokuya 1,5× örnek alırız.
 const typeScale=1.5;
 const c=document.createElement('canvas');c.width=Math.round(width*typeScale);c.height=Math.round(height*typeScale);
 const ctx=c.getContext('2d');ctx.scale(typeScale,typeScale);
 ctx.fillStyle=variant==='sign'?'#27332e':'#242c28';ctx.fillRect(0,0,width,height);
 ctx.strokeStyle='#b8a06d';ctx.lineWidth=5;ctx.strokeRect(16,16,width-32,height-32);
 ctx.fillStyle='#f1e5ce';ctx.textAlign='center';
 if(variant==='sign'){
  ctx.font='31px Georgia';ctx.fillText('✦    THE DIGITAL COLLECTION    ✦',width/2,78);
  ctx.font='normal 92px Georgia';ctx.fillText(text,width/2,220,width-65);
  ctx.font='24px Arial';ctx.letterSpacing='4px';ctx.fillText(subtitle,width/2,296);
 }else{
  const max=String(text).length>22?34:40;
  ctx.font=`bold ${max+4}px Arial`;let shown=String(text);if(shown.length>28)shown=shown.slice(0,27)+'…';
  ctx.fillText(shown,width/2,143,width-48);
  ctx.font='40px Georgia';ctx.fillText(subtitle,width/2,226,width-48);
  ctx.fillStyle='#decbb0';ctx.font='24px Arial';ctx.fillText('SERGİ ÜRÜNÜ   ·   360° İNCELE',width/2,291,width-48);
 }
 const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;
 t.minFilter=THREE.LinearMipmapLinearFilter;t.magFilter=THREE.LinearFilter;
 t.anisotropy=Math.min(8,renderer?.capabilities.getMaxAnisotropy()||8);return t;
}
function surfaceFrame(x,y,z,w,h,rotation,text,subtitle){
 const g=new THREE.Group();g.position.set(x,y,z);g.rotation.y=rotation;scene.add(g);
 const frameMat=material(0xbca273,.67,.35);box(w+.18,h+.18,.12,frameMat,0,0,0,g);
 box(w,h,.13,material(0x26332e),0,0,.08,g);
 const tex=txtCanvas(text,subtitle);const sign=new THREE.Mesh(new THREE.PlaneGeometry(w-.18,h-.18),new THREE.MeshBasicMaterial({map:tex}));sign.position.z=.16;g.add(sign);
}
// V5 | Modern mimari: açık resepsiyon, iki fiziksel yan salon, arka dijital sergi.
// Mobilden hızlı açılması için yansıtmalı post-processing/gölge haritaları kullanılmaz.
function makeWall(x,z0,z1,mat,thick=.25){
 if(z1-z0<.12)return;
 box(thick,6.35,z1-z0,mat,x,3.25,(z0+z1)/2);
 colliders.push({type:'rect',minX:x-thick/2-.24,maxX:x+thick/2+.24,minZ:z0-.22,maxZ:z1+.22});
}
function buildGlassSalonWalls(){
 const alloy=material(0x8cabae,.72,.3),dark=material(0x23333a,.45,.51),glow=new THREE.MeshBasicMaterial({color:0xc2e4db});
 const doorCenters=[];
 for(let z=8.5;z>=backZ+1.2;z-=12.8)doorCenters.push(z);
 for(const x of [-5.05,5.05]){
  const openings=doorCenters.map(z=>[Math.max(backZ+1,z-2.5),Math.min(12.45,z+2.5)]).sort((a,b)=>a[0]-b[0]);
  let cursor=backZ+1;
  for(const [from,to] of openings){if(from>cursor)makeWall(x,cursor,from,dark,.21);cursor=Math.max(cursor,to)}
  if(cursor<12.45)makeWall(x,cursor,12.45,dark,.21);
  // Kapıların üstündeki kesintisiz ışıklı lentolar yönlendirmeyi kolaylaştırır.
  for(const z of doorCenters){
   if(z-2.5<backZ+1||z+2.5>12.46)continue;
   box(.24,.26,5.25,alloy,x,6.52,z);
   box(.27,.042,4.65,glow,x,6.33,z);
   for(const offset of [-2.62,2.62])box(.31,6.10,.12,alloy,x,3.12,z+offset);
  }
 }
}
function ledLine(w,d,x,y,z,color=0xbfe0e4){return box(w,.026,d,new THREE.MeshBasicMaterial({color}),x,y,z)}
function makeOverheadSign(title,subtitle,z){
 const group=new THREE.Group();group.position.set(0,5.48,z);scene.add(group);
 box(6.95,1.18,.12,material(0x23323b,.55,.32),0,0,0,group);
 box(6.75,1.04,.12,material(0x141f25,.45,.48),0,0,.06,group);
 const texture=txtCanvas(title,subtitle,1000,350,'item');
 const face=new THREE.Mesh(new THREE.PlaneGeometry(6.35,.96),new THREE.MeshBasicMaterial({map:texture}));face.position.z=.14;group.add(face);
}
function setEnvironment(){
 scene=new THREE.Scene();scene.background=new THREE.Color(0x303d43);scene.fog=new THREE.FogExp2(0x303d43,mobile?.012:.008);
 const floor=material(0x979d9b,.18,.43),tile=material(0x6e7779,.05,.75),wall=material(0x3a484f,.2,.58);
 const marble=material(0xe0e4e1,.2,.37),glass=material(0x7fa6b3,.28,.48),alloy=material(0xa9b7b7,.76,.29);
 const bronze=material(0xc7a671,.67,.3),charcoal=material(0x1d2b30,.32,.58);
 box(28,.55,galleryLength,floor,0,-.28,galleryCenter);
 // Büyük karo zemin: her karoya ayrı mesh değil, yalnızca ince derz çizgileri.
 for(let x=-13;x<=13;x+=2.6)box(.024,.008,galleryLength-.5,tile,x,.007,galleryCenter);
 for(let z=backZ+.7;z<20.7;z+=2.6)box(27.7,.008,.024,tile,0,.008,z);
 // Merkezdeki kesintisiz yönlendirme çizgileri
 ledLine(.035,galleryLength-.6,-4.45,.018,galleryCenter,0xbdd3d3);
 ledLine(.035,galleryLength-.6,4.45,.018,galleryCenter,0xbdd3d3);
 for(let z=backZ+2;z<=20;z+=6.5){ledLine(2.2,.027,0,.022,z,0xd1b788)}
 box(.45,8.5,galleryLength,wall,-14,4.1,galleryCenter);
 box(.45,8.5,galleryLength,wall,14,4.1,galleryCenter);
 box(28,8.5,.4,wall,0,4.1,backZ);
 box(28,.22,galleryLength,charcoal,0,8.48,galleryCenter);
 // Giriş duvarı, dışarıdan içeri bakışı engellemeyen merkezi kapı
 for(const x of [-10.4,10.4])box(7.1,8.3,.4,wall,x,4.15,21);
 box(6.75,2.3,.4,wall,0,7.12,21);
 for(const x of [-7.15,7.15]){box(.24,8.1,.46,alloy,x,4.06,20.7);box(.09,7.5,.05,bronze,x,4,20.35)}
 // Işıklı duvar nişleri ve modern mimari dikeyler
 for(let z=backZ+3;z<20;z+=7.4){
  for(const x of [-13.65,13.65]){
   box(.15,6.65,2.7,marble,x,3.48,z);
   box(.18,6.05,.045,alloy,x,3.44,z-1.18);
   box(.18,6.05,.045,alloy,x,3.44,z+1.18);
  }
  box(27.45,.095,.12,alloy,0,7.8,z);
 }
 // Hafif aydınlatma: onlarca hareketli spot yerine ışıklı geometriler.
 for(let z=backZ+2.8;z<19.5;z+=5.4){
  for(const x of [-10.8,-2.4,2.4,10.8]){
   box(2.3,.06,.31,charcoal,x,8.19,z);
   ledLine(1.78,.13,x,8.139,z,0xe5e5d4);
  }
 }
 buildGlassSalonWalls();
 // Bölüm zeminleri renk farkıyla algılanır; duvarlardaki grafikler bağımsız salonları tanımlar.
 for(const x of [-9,9])box(7.3,.012,Math.max(5,galleryLength-13),material(x<0?0x9e9b93:0x858e93,.06,.56),x,.017,galleryCenter-4.7);
 surfaceFrame(-13.55,4.2,8.8,3.8,2.2,Math.PI/2,'SANAT SALONU','FİGÜRLER & ÖZGÜN TASARIMLAR');
 surfaceFrame(13.55,4.2,8.8,3.8,2.2,-Math.PI/2,'TEKNOLOJİ','IŞIK & MASAÜSTÜ TASARIMLAR');
 surfaceFrame(-13.55,4.2,-9,3.8,2.2,Math.PI/2,'KOLEKSİYON','KENDİNE ÖZGÜ PARÇALAR');
 surfaceFrame(13.55,4.2,-9,3.8,2.2,-Math.PI/2,'3D ATÖLYESİ','ÜRETİMDEN SERGİYE');
 makeOverheadSign('THREEDEE','SANAL TASARIM MÜZESİ',12.5);
 // Arka duvarda kullanıcının kendi ThreeDee bannerı (orijinal 1536 × 640 oranında).
 // Önceki pano ve logo kaldırıldı: aynı derinlikte üst üste binip titremesin.
 const bannerWidth=12.24,bannerHeight=bannerWidth*640/1536,bannerY=4.43;
 box(bannerWidth+.38,bannerHeight+.38,.16,material(0x9d9d97,.58,.4),0,bannerY,backZ+.33);
 box(bannerWidth+.12,bannerHeight+.12,.08,material(0x080a0c),0,bannerY,backZ+.44);
 const bannerTexture=new THREE.TextureLoader().load('/threedee-banner.jpg');
 bannerTexture.colorSpace=THREE.SRGBColorSpace;
 bannerTexture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
 const banner=new THREE.Mesh(new THREE.PlaneGeometry(bannerWidth,bannerHeight),new THREE.MeshBasicMaterial({map:bannerTexture,toneMapped:false}));
 banner.position.set(0,bannerY,backZ+.50);scene.add(banner);
 buildReception();buildDigitalExhibit();
 scene.add(new THREE.HemisphereLight(0xe3f5fb,0x20292a,mobile?2.45:2.65));
 const sun=new THREE.DirectionalLight(0xffeed9,mobile?2.15:2.7);sun.position.set(3.8,11,13);scene.add(sun);
}
function buildReception(){
 const x=-3.45,z=16.20,group=new THREE.Group();group.position.set(x,0,z);scene.add(group);
 const stone=material(0xe9e5da,.15,.35),black=material(0x25333a,.5,.34),bronze=material(0xcaa86d,.66,.28);
 box(2.0,.26,1.0,stone,0,1.26,0,group);
 box(1.85,1.13,.85,black,0,.59,0,group);
 box(1.82,.044,.91,bronze,0,1.08,.0,group);
 box(1.4,.53,.04,stone,0,.72,.45,group);
 const plaque=new THREE.Mesh(new THREE.PlaneGeometry(1.33,.43),new THREE.MeshBasicMaterial({map:txtCanvas('THREEDEE','DANIŞMA • HOŞ GELDİN',630,320,'item')}));
 plaque.position.set(0,.72,.48);group.add(plaque);
 const monitor=box(.72,.54,.055,black,0,1.66,-.1,group);monitor.rotation.x=-.18;
 const screen=box(.61,.42,.058,new THREE.MeshBasicMaterial({color:0x95d0d4}),0,1.67,-.058,group);screen.rotation.x=-.18;
 cyl(.06,.06,.28,bronze,0,1.38,-.15,group,12);
 group.userData.guestbook=true;
 colliders.push({x,z,r:1.25});receptionStand={x,z,group};
}
function buildDigitalExhibit(){
 const group=new THREE.Group();group.position.set(0,0,backZ+3.15);scene.add(group);
 const bronze=material(0xc4ab7d,.65,.32),dark=material(0x26343a,.43,.53),cool=material(0x80d8db,.48,.22);
 cyl(.83,.94,.21,dark,0,.11,0,group,28);
 cyl(.75,.8,.08,bronze,0,.25,0,group,28);
 const knot=mesh(new THREE.TorusKnotGeometry(.36,.095,mobile?48:85,8,2,3),cool,[0,1.42,0],group);knot.rotation.x=.4;
 const ring=torus(.87,.025,bronze,0,1.45,0,group);ring.rotation.y=.30;
 const ring2=torus(.83,.025,cool,0,1.45,0,group);ring2.rotation.x=.45;
 const label=new THREE.Mesh(new THREE.PlaneGeometry(3.4,1.12),new THREE.MeshBasicMaterial({map:txtCanvas('DİJİTAL SANAT','TEKNOLOJİ İLE TASARIM',800,350,'item')}));
 label.position.set(0,3.3,.0);group.add(label);
 colliders.push({x:0,z:backZ+3.15,r:1.05});museumObjects.push({group,ring,ring2,knot});
}
function roomCounts(){return {art:products.filter(p=>roomOf(p)==='art').length,design:products.filter(p=>roomOf(p)==='design').length}}
function buildStands(){
 const count={art:0,design:0};
 const base=material(0x333f44,.38,.39),top=material(0xd7deda,.31,.37),brass=material(0xbba276,.75,.28);
 const fixture=new THREE.MeshBasicMaterial({color:0xb3e2d7});
 const glassMat=new THREE.MeshPhysicalMaterial({color:0xe0f5fb,transparent:true,opacity:.075,roughness:.16,metalness:.05,depthWrite:false,side:THREE.DoubleSide});
 for(let i=0;i<products.length;i++){
  const p=products[i],room=roomOf(p),idx=count[room]++;
  const pos={x:room==='art'?-9.0:9.0,z:10.1-idx*6.4};
  const pedestal=new THREE.Group();pedestal.position.set(pos.x,0,pos.z);scene.add(pedestal);
  cyl(1.56,1.64,.19,base,0,.105,0,pedestal,10);
  cyl(1.3,1.38,.91,base,0,.66,0,pedestal,10);
  cyl(1.35,1.36,.09,brass,0,1.16,0,pedestal,16);
  cyl(1.32,1.34,.075,top,0,1.26,0,pedestal,16);
  // Yuvarlatılmış şeffaf vitrin + ince metal iskelet.
  const glass=new THREE.Mesh(new THREE.CylinderGeometry(1.14,1.14,2.26,mobile?12:24,1,true),glassMat);
  glass.position.y=2.43;pedestal.add(glass);
  cyl(1.16,1.16,.05,brass,0,3.58,0,pedestal,16);
  cyl(1.17,1.17,.07,base,0,3.64,0,pedestal,16);
  cyl(.57,.57,.03,fixture,0,3.595,0,pedestal,16);
  for(const theta of [0,Math.PI/2,Math.PI,Math.PI*1.5]){
   const x=Math.cos(theta)*1.11,z=Math.sin(theta)*1.11;
   cyl(.018,.018,2.27,brass,x,2.46,z,pedestal,7);
  }
  const display=new THREE.Group();display.position.y=1.33;pedestal.add(display);
  const labelGroup=new THREE.Group();labelGroup.position.set(0,.67,1.53);pedestal.add(labelGroup);
  box(2.15,.89,.10,brass,0,0,0,labelGroup);
  box(2.04,.79,.11,material(0x223039,.46,.36),0,0,.06,labelGroup);
  mesh(new THREE.PlaneGeometry(1.99,.75),new THREE.MeshBasicMaterial({map:txtCanvas(p.name,money(p.price),650,380,'item')}),[0,0,.121],labelGroup);
  pedestal.userData.productId=p.id;
  const placeholder=normalized(demoModel(p.modelUrl?{...p,shape:'abstract'}:p));display.add(placeholder);placeholder.position.y=.04;
  stands.push({p,pos,room,pedestal,display,placeholder,actual:null,loading:false,failed:false});
  colliders.push({x:pos.x,z:pos.z,r:1.68});
 }
}
function buildGuestbookStand(){
 // Resepsiyon karşısında açılabilir fiziksel ziyaretçi defteri.
 const x=3.65,z=15.35,group=new THREE.Group();group.position.set(x,0,z);scene.add(group);
 const stone=material(0x414e54,.42,.45),bronze=material(0xc5aa7b,.65,.33),paper=material(0xebe6d9,.05,.75);
 cyl(.64,.73,.17,stone,0,.09,0,group,10);cyl(.16,.2,1.17,stone,0,.72,0,group,10);
 const top=box(1.81,.12,1.13,bronze,0,1.41,0,group);top.rotation.x=-.18;
 const book=new THREE.Group();book.position.set(0,1.53,.06);book.rotation.x=-.18;group.add(book);
 box(1.35,.055,.88,stone,0,0,0,book);box(1.26,.062,.78,paper,0,.07,0,book);
 box(.022,.085,.72,bronze,0,.118,0,book);
 for(let t=-1;t<=1;t++)box(.37,.012,.028,bronze,t*.35,.13,.10,book);
 const label=new THREE.Mesh(new THREE.PlaneGeometry(2.55,.98),new THREE.MeshBasicMaterial({map:txtCanvas('MÜZE DEFTERİ','ZİYARETÇİ YORUMLARI',750,350,'item')}));
 label.position.set(0,2.65,0);group.add(label);
 group.userData.guestbook=true;colliders.push({x,z,r:1.08});guestbookStand={x,z,group};
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
 if(!active||modalOpen||catalogOpen||guestbookOpen||roomOpen)return;
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
  const swatch=document.createElement('span');swatch.className='catalog-swatch';swatch.style.color=p.color;
  if(p.photos?.length){const img=document.createElement('img');img.src=p.photos[0];img.alt='';img.loading='lazy';swatch.append(img)}else swatch.textContent=icons[p.shape]||'◈';
  const data=document.createElement('span');data.className='catalog-data';
  const strong=document.createElement('strong');strong.textContent=p.name;
  const small=document.createElement('small');small.textContent=`${money(p.price)}  ·  ${p.rating?.count?`★ ${p.rating.average} (${p.rating.count})`:p.isDemo?'ÖRNEK MODEL':'3D MODEL'}`;
  const arrow=document.createElement('span');arrow.className='catalog-arrow';arrow.textContent='↗';data.append(strong,small);btn.append(number,swatch,data,arrow);btn.addEventListener('click',()=>openProduct(p));list.append(btn);
 });
}
function setShade(){const show=catalogOpen||modalOpen||guestbookOpen||roomOpen;$('shade').hidden=!show;}
function openCatalog(){if(modalOpen)return;closeRooms();catalogOpen=true;$('catalogDrawer').classList.add('open');$('catalogDrawer').setAttribute('aria-hidden','false');setShade()}
function closeCatalog(){catalogOpen=false;$('catalogDrawer').classList.remove('open');$('catalogDrawer').setAttribute('aria-hidden','true');setShade()}
function fitViewer(){if(!viewerRenderer||!$('productViewer').clientWidth)return;const el=$('productViewer');const w=el.clientWidth,h=el.clientHeight;viewerRenderer.setSize(w,h);viewerCamera.aspect=w/h;viewerCamera.updateProjectionMatrix()}
function initViewer(){
 const el=$('productViewer');viewerScene=new THREE.Scene();viewerScene.background=new THREE.Color(0xd9d8c9);
 viewerCamera=new THREE.PerspectiveCamera(39,1,.05,100);viewerCamera.position.set(3.6,2.6,4.6);
 viewerRenderer=new THREE.WebGLRenderer({alpha:false,antialias:true,powerPreference:'default'});
 viewerRenderer.setPixelRatio(renderDpr(true));viewerRenderer.outputColorSpace=THREE.SRGBColorSpace;
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
 const loop=()=>{viewerFrame=requestAnimationFrame(loop);if(!modalOpen||photoMode)return;viewerControl.update();viewerRenderer.render(viewerScene,viewerCamera)};loop();
}
let loadTicket=0;
async function openProduct(p){
 if(!p)return;
 closeCatalog();closeRooms();modalOpen=true;currentProduct=p;touchJoy={x:0,y:0};$('joyKnob').style.transform='';setShade();
 $('productModal').classList.add('open');$('productModal').setAttribute('aria-hidden','false');
 renderProductPhotos(p);selectViewerMode(false);resetRating();loadProductReviews(p,true);setShopProduct(p);
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
function closeProduct(){loadTicket++;reviewTicket++;modalOpen=false;currentProduct=null;$('productModal').classList.remove('open');$('productModal').setAttribute('aria-hidden','true');setShade()}
function selectViewerMode(photos){
 photoMode=!!photos && !!currentProduct?.photos?.length;
 $('productPhotoStage').hidden=!photoMode;$('productViewer').hidden=photoMode;
 $('viewerLoading').hidden=photoMode||$('viewerLoading').hidden;
 $('viewerStamp').hidden=photoMode;$('mode3d').classList.toggle('selected',!photoMode);$('modePhotos').classList.toggle('selected',photoMode);
 $('productModal').classList.toggle('showing-photos',photoMode);
 if(!photoMode){fitViewer();if(viewerControl)viewerControl.update()}
}
function viewPhoto(i){
 const pics=currentProduct?.photos||[];if(!pics.length)return;
 photoIndex=Math.max(0,Math.min(i,pics.length-1));$('productBigPhoto').src=pics[photoIndex];
 for(const [index,btn] of [...$('productPhotoThumbs').children].entries())btn.classList.toggle('active',index===photoIndex);
 selectViewerMode(true);
}
function renderProductPhotos(p){
 const pics=p.photos||[];$('modePhotos').hidden=!pics.length;$('productPhotoSection').hidden=!pics.length;
 $('productPhotoStrip').replaceChildren();$('productPhotoThumbs').replaceChildren();
 for(const [i,url] of pics.entries()){
  const make=(cls)=>{const btn=document.createElement('button');btn.type='button';btn.className=cls;btn.setAttribute('aria-label',`Fotoğraf ${i+1}`);
   const img=document.createElement('img');img.src=url;img.alt=`${p.name} fotoğraf ${i+1}`;img.loading='lazy';btn.append(img);btn.addEventListener('click',()=>viewPhoto(i));return btn};
  $('productPhotoStrip').append(make('product-photo-mini'));
  $('productPhotoThumbs').append(make('product-photo-thumb'));
 }
}
function dateLabel(date){try{return new Intl.DateTimeFormat('tr-TR',{day:'numeric',month:'short',year:'numeric'}).format(new Date(date))}catch{return ''}}
function commentCard(r){const article=document.createElement('article');article.className='visitor-note';
 const top=document.createElement('div');top.className='note-top';
 const name=document.createElement('strong');name.textContent=r.name;
 const time=document.createElement('small');time.textContent=dateLabel(r.createdAt);top.append(name,time);article.append(top);
 if(r.rating){const stars=document.createElement('div');stars.className='note-stars';stars.textContent='★'.repeat(r.rating)+'☆'.repeat(5-r.rating);article.append(stars)}
 const body=document.createElement('p');body.className='note-message';body.textContent=r.message;article.append(body);return article;
}
async function getJson(url,options={}){const res=await fetch(url,{cache:'no-store',...options});let body={};try{body=await res.json()}catch{}if(!res.ok)throw new Error(body.error||'İstek başarısız.');return body}
function selectRating(n){chosenRating=n;for(const btn of document.querySelectorAll('#ratingChooser button')){const on=Number(btn.dataset.rating)<=n;btn.classList.toggle('selected',on);btn.setAttribute('aria-pressed',String(Number(btn.dataset.rating)===n))}}
function resetRating(){selectRating(0);$('productReviewForm').reset();$('productReviewMessage').textContent=''}
async function loadProductReviews(p,reset){
 const ticket=++reviewTicket;const page=reset?1:reviewPage+1;
 if(reset){reviewPage=1;$('productReviewList').replaceChildren();$('productReviewList').textContent='Yorumlar yükleniyor…'}
 try{
  const data=await getJson(`/api/products/${encodeURIComponent(p.id)}/reviews?page=${page}`);
  if(ticket!==reviewTicket||currentProduct?.id!==p.id)return;
  reviewPage=page;if(reset)$('productReviewList').replaceChildren();
  if(!data.total){$('productReviewList').textContent='Henüz yorum yapılmamış. İlk değerlendirme senden gelsin.'}
  else for(const r of data.items)$('productReviewList').append(commentCard(r));
  $('loadMoreProductReviews').hidden=!data.hasMore;
  $('reviewAverage').textContent=data.rating.count?`★ ${data.rating.average} / 5`:'Henüz puan yok';$('reviewCount').textContent=data.rating.count?`${data.rating.count} değerlendirme`:'';
 }catch(err){if(ticket===reviewTicket)$('productReviewList').textContent=err.message}
}
async function submitProductReview(e){e.preventDefault();if(!currentProduct)return;
 if(!chosenRating){$('productReviewMessage').textContent='Önce 1–5 yıldız seç.';return}
 const p=currentProduct;const btn=e.currentTarget.querySelector('button[type=submit]');btn.disabled=true;
 $('productReviewMessage').textContent='';try{
  await getJson(`/api/products/${encodeURIComponent(p.id)}/reviews`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:$('reviewName').value,message:$('reviewMessage').value,rating:chosenRating,website:$('reviewWebsite').value})});
  $('productReviewMessage').textContent='Yorumun yayınlandı. Teşekkürler!';
  $('reviewMessage').value='';selectRating(0);await loadProductReviews(p,true);
 }catch(err){$('productReviewMessage').textContent=err.message}finally{btn.disabled=false}
}
function openGuestbook(){if(!active||modalOpen)return;closeCatalog();closeRooms();guestbookOpen=true;touchJoy={x:0,y:0};$('joyKnob').style.transform='';setShade();
 $('guestbookModal').classList.add('open');$('guestbookModal').setAttribute('aria-hidden','false');$('guestFeedback').textContent='';loadGuestbook(true)}
function closeGuestbook(){guestTicket++;guestbookOpen=false;$('guestbookModal').classList.remove('open');$('guestbookModal').setAttribute('aria-hidden','true');setShade()}
async function loadGuestbook(reset){const ticket=++guestTicket;const page=reset?1:bookPage+1;
 if(reset){bookPage=1;$('guestbookEntries').textContent='Defter açılıyor…'}
 try{const data=await getJson(`/api/guestbook?page=${page}`);
  if(!guestbookOpen||ticket!==guestTicket)return;if(reset)$('guestbookEntries').replaceChildren();bookPage=page;
  if(!data.total)$('guestbookEntries').textContent='Defter henüz boş. İlk notu sen bırak!';
  else for(const r of data.items)$('guestbookEntries').append(commentCard(r));
  $('moreGuestbook').hidden=!data.hasMore;
 }catch(err){if(ticket===guestTicket)$('guestbookEntries').textContent=err.message}
}
async function submitGuestbook(e){e.preventDefault();const btn=e.currentTarget.querySelector('button[type=submit]');btn.disabled=true;
 $('guestFeedback').textContent='';try{
  await getJson('/api/guestbook',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:$('guestName').value,message:$('guestMessage').value,website:$('guestWebsite').value})});
  $('guestMessage').value='';$('guestFeedback').textContent='Notun müze defterine eklendi. Teşekkürler!';await loadGuestbook(true);
 }catch(err){$('guestFeedback').textContent=err.message}finally{btn.disabled=false}
}
function resetCamera(){camera.position.set(0,1.68,17.65);yaw=0;pitch=-.03;camera.rotation.set(pitch,yaw,0,'YXZ');keys.clear();touchJoy={x:0,y:0};$('joyKnob').style.transform=''}
function allowed(x,z){
 if(x<-12.85||x>12.85||z<backZ+1.62||z>19.15)return false;
 for(const o of colliders){
  if(o.type==='rect'){if(x>o.minX&&x<o.maxX&&z>o.minZ&&z<o.maxZ)return false}
  else if(Math.hypot(x-o.x,z-o.z)<o.r+.30)return false;
 }
 return true;
}
function navigate(dt){
 if(!active||catalogOpen||modalOpen||guestbookOpen||roomOpen)return;
 const forward=Number(keys.has('KeyW')||keys.has('ArrowUp'))-Number(keys.has('KeyS')||keys.has('ArrowDown'))-touchJoy.y;
 const side=Number(keys.has('KeyD')||keys.has('ArrowRight'))-Number(keys.has('KeyA')||keys.has('ArrowLeft'))+touchJoy.x;
 let f=forward,s=side;const len=Math.hypot(f,s);if(len<.04){isMoving=false;return}isMoving=true;
 f/=Math.max(len,1);s/=Math.max(len,1);
 const speed=mobile?3.5:4.5;
 const dx=(-Math.sin(yaw)*f+Math.cos(yaw)*s)*speed*Math.min(dt,.055);
 const dz=(-Math.cos(yaw)*f-Math.sin(yaw)*s)*speed*Math.min(dt,.055);
 if(allowed(camera.position.x+dx,camera.position.z))camera.position.x+=dx;
 if(allowed(camera.position.x,camera.position.z+dz))camera.position.z+=dz;
}
function updateRoomIndicator(){
 let room='MERKEZ KORİDORU',description='Salonlar arasında keşfe çık.';
 if(camera.position.z>12.4){room='GİRİŞ LOBİSİ';description='Resepsiyon & ziyaretçi defteri';}
 else if(camera.position.x<-5.05){room='SANAT SALONU';description='Figürler ve özgün heykeller';}
 else if(camera.position.x>5.05){room='TASARIM SALONU';description='Işık ve teknolojik tasarımlar';}
 else if(camera.position.z<backZ+10){room='DİJİTAL SERGİ';description='ThreeDee özel koleksiyonu';}
 if(room===lastRoom)return;lastRoom=room;
 $('hudRoomTitle').textContent=room;$('hudRoomSub').textContent=description;
 $('roomCurrent').textContent=room;
}
let proximityMs=0;
function updateProximity(dt){
 proximityMs+=dt;if(proximityMs<.16)return;proximityMs=0;
 updateRoomIndicator();nearest=null;let best=Infinity;
 for(const s of stands){const dist=Math.hypot(camera.position.x-s.pos.x,camera.position.z-s.pos.z);
  if(dist<best){best=dist;nearest=s.p}
 }
 const bookDist=guestbookStand?Math.hypot(camera.position.x-guestbookStand.x,camera.position.z-guestbookStand.z):Infinity;
 const deskDist=receptionStand?Math.hypot(camera.position.x-receptionStand.x,camera.position.z-receptionStand.z):Infinity;
 const guestDist=Math.min(bookDist,deskDist);
 nearestGuestbook=guestDist<3.7&&guestDist<best;
 const near=best<4.8;
 $('hintText').textContent=nearestGuestbook?'Resepsiyon · E / Müze defterini aç':near&&nearest?`${nearest.name} · E / İncele`:'Bir vitrinin yanına git veya Salonlar menüsünü aç.';
 $('interactMobile').disabled=!near&&!nearestGuestbook;$('interactMobile').textContent=nearestGuestbook?'✎ Defteri aç':near?'✦ Ürünü incele':'✦ Vitrine yaklaş';
 if(!near)nearest=null;
}
function openRooms(){
 if(!active){showToast('Önce müzeye giriş yap.');return}
 if(modalOpen||guestbookOpen)return;
 closeCatalog();roomOpen=true;keys.clear();touchJoy={x:0,y:0};$('joyKnob').style.transform='';
 $('roomPanel').classList.add('open');$('roomPanel').setAttribute('aria-hidden','false');setShade();
}
function closeRooms(){roomOpen=false;$('roomPanel').classList.remove('open');$('roomPanel').setAttribute('aria-hidden','true');setShade()}
function goRoom(room){
 closeRooms();let x=0,z=17.65,direction=0;
 if(room==='art'){x=-6.72;z=8.0;direction=Math.PI/2}
 if(room==='design'){x=6.72;z=8.0;direction=-Math.PI/2}
 if(room==='signature'){x=0;z=backZ+7;direction=0}
 if(!allowed(x,z)){
  // Çarpışmaların çevresindeki güvenli bölgeyi bul, kullanıcı duvar içine yerleşmesin.
  let found=false;for(let radius=0;radius<=4&&!found;radius+=.5)for(let a=0;a<16;a++){
   const xx=x+Math.cos(a*Math.PI/8)*radius,zz=z+Math.sin(a*Math.PI/8)*radius;
   if(allowed(xx,zz)){x=xx;z=zz;found=true;break}
  }
  if(!found){x=0;z=17.65;direction=0}
 }
 camera.position.set(x,1.68,z);yaw=direction;pitch=-.045;camera.rotation.set(pitch,yaw,0,'YXZ');
 keys.clear();touchJoy={x:0,y:0};$('joyKnob').style.transform='';lastRoom='';updateRoomIndicator();updateProximity(.25);
 showToast('Seçtiğin salondasın. Etrafına bakarak keşfet!');
}
function setupWalk(){
 const c=renderer.domElement;let pointer=null;
 c.addEventListener('pointerdown',e=>{if(!active||modalOpen||catalogOpen||guestbookOpen||roomOpen)return;
  if(e.button!==0 && e.pointerType==='mouse')return;
  pointer={id:e.pointerId,x:e.clientX,y:e.clientY,total:0,prevX:e.clientX,prevY:e.clientY};c.setPointerCapture(e.pointerId);
 });
 c.addEventListener('pointermove',e=>{if(!pointer||pointer.id!==e.pointerId||modalOpen||catalogOpen||guestbookOpen||roomOpen)return;
  const dx=e.clientX-pointer.prevX,dy=e.clientY-pointer.prevY;
  pointer.total+=Math.hypot(dx,dy);pointer.prevX=e.clientX;pointer.prevY=e.clientY;
  yaw-=dx*.0042;pitch=Math.max(-.75,Math.min(.78,pitch-dy*.0035));
 });
 c.addEventListener('pointerup',e=>{
  if(!pointer||pointer.id!==e.pointerId)return;
  const p=pointer;pointer=null;if(p.total>12)return;
  const mouse=new THREE.Vector2(e.clientX/innerWidth*2-1,-(e.clientY/innerHeight)*2+1);
  raycaster.setFromCamera(mouse,camera);
  const matches=raycaster.intersectObjects([...stands.map(s=>s.pedestal),guestbookStand.group,receptionStand.group],true);
  let hit=matches[0]?.object;while(hit&&!hit.userData.productId&&!hit.userData.guestbook)hit=hit.parent;
  const id=hit?.userData?.productId;
  if(hit?.userData?.guestbook)openGuestbook();else if(id)openProduct(products.find(x=>x.id===id));
 });
 c.addEventListener('pointercancel',()=>pointer=null);
 window.addEventListener('keydown',e=>{
  if(e.target?.closest?.('input,textarea,select,[contenteditable="true"]')){if(e.code==='Escape'){if(modalOpen)closeProduct();else if(guestbookOpen)closeGuestbook()}return}
  if(HANDLED.has(e.code))e.preventDefault();keys.add(e.code);
  if(e.code==='KeyM'&&active&&!modalOpen&&!guestbookOpen){roomOpen?closeRooms():openRooms();return}
  if(e.code==='KeyE'&&!modalOpen&&!guestbookOpen&&!catalogOpen&&!roomOpen&&active){if(nearestGuestbook)openGuestbook();else if(nearest)openProduct(nearest);else showToast('Bir ürüne veya ziyaretçi defterine yaklaş.');}
  if(e.code==='Escape'){if(modalOpen)closeProduct();else if(guestbookOpen)closeGuestbook();else if(catalogOpen)closeCatalog();else if(roomOpen)closeRooms();}
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
// Lightweight live-museum visitors. Positions are ephemeral; no visitor details are saved.
const remoteAvatars=new Map();
const avatarPalette=[0xe6b486,0x92ccd3,0xb6a8eb,0xd58eaa,0xa1d69c,0xeacc92];
function avatarLabel(name){
 const c=document.createElement('canvas');c.width=640;c.height=160;
 const ctx=c.getContext('2d');ctx.fillStyle='rgba(20,30,33,.94)';ctx.beginPath();ctx.roundRect(2,2,636,152,32);ctx.fill();
 ctx.fillStyle='#f6f1e5';ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='bold 50px Arial';ctx.fillText(String(name).slice(0,22),320,82,580);
 const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;
 tex.anisotropy=Math.min(8,renderer?.capabilities.getMaxAnisotropy()||8);
 const pane=new THREE.Mesh(new THREE.PlaneGeometry(1.35,.34),new THREE.MeshBasicMaterial({map:tex,transparent:true,depthWrite:false}));pane.position.y=2.38;return pane;
}
function makeAvatar(visitor){
 const group=new THREE.Group();const color=new THREE.Color(visitor.color||avatarPalette[0]);
 const jacket=new THREE.MeshStandardMaterial({color,roughness:.75,metalness:.04});
 const face=new THREE.MeshStandardMaterial({color:0xe5b99b,roughness:.85});
 const trousers=new THREE.MeshStandardMaterial({color:0x29333b,roughness:.9});
 const torso=new THREE.Mesh(new THREE.CapsuleGeometry(.27,.82,3,8),jacket);torso.position.y=1.19;group.add(torso);
 const head=new THREE.Mesh(new THREE.SphereGeometry(.24,12,9),face);head.position.y=1.91;group.add(head);
 for(const v of [-1,1]){const leg=new THREE.Mesh(new THREE.CylinderGeometry(.105,.12,.62,8),trousers);leg.position.set(v*.13,.43,0);group.add(leg);
  const arm=new THREE.Mesh(new THREE.CylinderGeometry(.08,.085,.72,8),jacket);arm.position.set(v*.33,1.25,0);arm.rotation.z=v*.20;group.add(arm)}
 const eyes=new THREE.Mesh(new THREE.SphereGeometry(.055,8,8),new THREE.MeshBasicMaterial({color:0x25343c}));eyes.position.set(0,1.95,-.23);group.add(eyes);
 const label=avatarLabel(visitor.name);group.add(label);label.material.depthTest=false;
 group.position.set(visitor.x,0,visitor.z);group.rotation.y=visitor.yaw||0;scene.add(group);
 return {group,target:new THREE.Vector3(visitor.x,0,visitor.z),yaw:visitor.yaw||0,age:performance.now(),label};
}
function receiveVisitors(data){
 $('presenceCount').textContent=`● ${Number(data.count)||1} ziyaretçi`;
 const valid=new Set();
 for(const visitor of (data.visitors||[]).slice(0,mobile?14:28)){
  if(!visitor||!Number.isFinite(visitor.x)||!Number.isFinite(visitor.z))continue;
  valid.add(visitor.id);let a=remoteAvatars.get(visitor.id);
  if(!a){a=makeAvatar(visitor);remoteAvatars.set(visitor.id,a)}
  a.target.set(visitor.x,0,visitor.z);a.yaw=visitor.yaw||0;a.age=performance.now();
 }
 for(const [id,a] of remoteAvatars){if(!valid.has(id)){scene.remove(a.group);a.label.material.map.dispose();a.group.traverse(obj=>{if(obj.isMesh){obj.geometry.dispose();if(obj.material!==a.label.material)obj.material.dispose()}});a.label.material.dispose();remoteAvatars.delete(id)}}
}
function updateAvatars(dt){for(const a of remoteAvatars.values()){a.group.position.lerp(a.target,Math.min(1,dt*5));a.group.rotation.y+=Math.atan2(Math.sin(a.yaw-a.group.rotation.y),Math.cos(a.yaw-a.group.rotation.y))*Math.min(1,dt*5);a.label.rotation.y=-a.group.rotation.y+camera.rotation.y;}}
function initPresence(){
 let busy=false;
 async function pulse(){
  if(!active||document.hidden||!scene||busy)return;
  busy=true;try{const r=await fetch('/api/presence',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({x:+camera.position.x.toFixed(2),z:+camera.position.z.toFixed(2),yaw:+yaw.toFixed(2)}),signal:AbortSignal.timeout(4000)});
   if(r.ok)receiveVisitors(await r.json());
  }catch(err){console.warn('Canlı ziyaretçi bağlantısı:',err.message)}finally{busy=false}
 }
 setInterval(pulse,2500);document.addEventListener('visibilitychange',()=>{if(!document.hidden)pulse()});pulse();
}
function animate(){
 requestAnimationFrame(animate);
 const dt=Math.min(clock.getDelta(),.07);
 // Sekme arka plandayken GPU kullanımını azalt. Mobilde 30 FPS hedefle.
 if(document.hidden)return;
 drawAccumulator+=dt;
 if(mobile&&drawAccumulator<1/30)return;
 const step=mobile?Math.min(drawAccumulator,.065):dt;drawAccumulator=0;
 navigate(step);camera.rotation.set(pitch,yaw,0,'YXZ');updateAvatars(step);
 if(!guestbookOpen&&!roomOpen)updateProximity(step);
 refreshNearbyModels(step);
 if(active&&!modalOpen&&!catalogOpen&&!guestbookOpen&&!roomOpen){
  for(const stand of stands)stand.display.rotation.y+=step*.15;
  for(const art of museumObjects){art.ring.rotation.y+=step*.27;art.ring2.rotation.x+=step*.11;art.knot.rotation.y-=step*.24}
 }
 if(!modalOpen&&!catalogOpen&&!guestbookOpen&&!roomOpen)renderer.render(scene,camera);
}
async function init(){
 try{
  renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
  renderer.setPixelRatio(renderDpr());renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.47;
  renderer.setSize(innerWidth,innerHeight);$('museumCanvas').append(renderer.domElement);
  clock=new THREE.Clock();camera=new THREE.PerspectiveCamera(mobile?75:68,innerWidth/innerHeight,.12,110);
  products=await getProducts();
  const counts=roomCounts();const maxRows=Math.max(5,counts.art,counts.design);
  const lastZ=10.1-(maxRows-1)*6.4;
  backZ=Math.min(-20.8,lastZ-5.15);galleryLength=21-backZ;galleryCenter=(21+backZ)/2;
  $('artCount').textContent=counts.art+' eser';$('designCount').textContent=counts.design+' eser';
  setEnvironment();resetCamera();buildStands();buildGuestbookStand();renderCatalog();setupWalk();animate();updateRoomIndicator();
  initShop({products:()=>products,openProduct,toast:showToast});initPresence();
  $('loadingScreen').remove();
  window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();applyGraphicsQuality()});
 }catch(e){console.error(e);$('loadingScreen').innerHTML='<div>3D müze açılamadı.</div><div style="font:12px Arial;color:#c6ad8e;letter-spacing:0">Tarayıcında WebGL desteğini ve internet bağlantını kontrol et.</div>'}
}
const bgMusic=$('classicalAmbience'),musicButton=$('toggleMusic');
bgMusic.volume=.21;
let musicEnabled=true;
function updateMusicButton(){musicButton.textContent=musicEnabled?'♫ Müzik açık':'♪ Müzik kapalı';musicButton.setAttribute('aria-pressed',String(musicEnabled));}
async function tryPlayMusic(){if(!musicEnabled)return;try{await bgMusic.play();}catch(e){console.warn('Müzik kullanıcı izni bekliyor:',e.message);}}
musicButton.addEventListener('click',()=>{musicEnabled=!musicEnabled;updateMusicButton();if(musicEnabled)tryPlayMusic();else bgMusic.pause()});
updateMusicButton();
$('enterMuseum').addEventListener('click',()=>{$('welcome').hidden=true;active=true;tryPlayMusic();showToast(mobile?'Sol joystick ile yürü, sağdaki boş alanda sürükleyerek bak.':'WASD ile yürü, fareyle bak; M ile salonları aç.');});
$('openCatalog').addEventListener('click',openCatalog);$('closeCatalog').addEventListener('click',closeCatalog);
$('shade').addEventListener('click',()=>{closeCatalog();closeProduct();closeGuestbook();closeRooms()});
$('openRooms').addEventListener('click',openRooms);$('closeRooms').addEventListener('click',closeRooms);
for(const btn of document.querySelectorAll('[data-room]'))btn.addEventListener('click',()=>goRoom(btn.dataset.room));
$('closeProduct').addEventListener('click',closeProduct);$('closeProduct2').addEventListener('click',closeProduct);
$('resetPosition').addEventListener('click',()=>{resetCamera();lastRoom='';updateRoomIndicator();showToast('Giriş lobisine döndün.');});$('interactMobile').addEventListener('click',()=>{if(nearestGuestbook)openGuestbook();else if(nearest)openProduct(nearest)});
$('openGuestbook').addEventListener('click',openGuestbook);$('closeGuestbook').addEventListener('click',closeGuestbook);
$('mode3d').addEventListener('click',()=>selectViewerMode(false));$('modePhotos').addEventListener('click',()=>selectViewerMode(true));
$('loadMoreProductReviews').addEventListener('click',()=>currentProduct&&loadProductReviews(currentProduct,false));
$('moreGuestbook').addEventListener('click',()=>loadGuestbook(false));
for(const btn of document.querySelectorAll('[data-rating]'))btn.addEventListener('click',()=>selectRating(Number(btn.dataset.rating)));
$('productReviewForm').addEventListener('submit',submitProductReview);
$('guestbookForm').addEventListener('submit',submitGuestbook);
$('fullScreen').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen()}catch{showToast('Tarayıcı tam ekranı desteklemiyor.')}});
$('graphicsQuality').addEventListener('click',()=>{
 graphicsQuality=graphicsQuality==='hd'?'ultra':graphicsQuality==='ultra'?'balanced':'hd';
 try{localStorage.setItem(GRAPHICS_KEY,graphicsQuality)}catch{}
 applyGraphicsQuality();
 showToast(`Görüntü: ${GRAPHICS_PRESETS[graphicsQuality].name}${graphicsQuality==='ultra'?' · Yavaşlarsa Dengeli seçebilirsin.':''}`);
});
refreshQualityButton();
init();
