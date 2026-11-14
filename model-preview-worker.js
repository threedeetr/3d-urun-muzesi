'use strict';
// Geometrisi yoğun 3MF/STL dosyalarından tarayıcıya uygun, düşük poligonlu GLB önizleme üretir.
// Ayrı Worker Thread'de çalışır: tek bir sorunlu dosya Node sunucusunu kilitlemez.
const { parentPort, workerData } = require('node:worker_threads');
const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');
const MAX_TRIANGLES = 36000;
const MAX_XML_BYTES = 115 * 1024 * 1024;
const MAX_SINGLE_XML = 75 * 1024 * 1024;
const MAX_VERTICES = 1100000;
function error(message){throw new Error(message)}
function attribute(tag,name){
 const m=new RegExp('(?:^|\\s)'+name+'\\s*=\\s*["\']([^"\']+)["\']','i').exec(tag);
 return m?m[1]:null;
}
function finiteNumber(v){const n=Number(v);return Number.isFinite(n)?n:null}
function zipModels(buf){
 // ZIP32 central directory. 3MF dosyasındaki tüm .model parçalarını bulur.
 let end=-1;for(let i=buf.length-22;i>=Math.max(0,buf.length-65557);i--){if(buf.readUInt32LE(i)===0x06054b50){end=i;break}}
 if(end<0)error('Geçerli ZIP/3MF dizini bulunamadı.');
 let count=buf.readUInt16LE(end+10),offset=buf.readUInt32LE(end+16);
 if(count>450||offset>=buf.length)error('3MF arşivi çok karmaşık.');
 let budget=MAX_XML_BYTES;const models=[];
 for(let k=0;k<count;k++){
  if(offset+46>buf.length||buf.readUInt32LE(offset)!==0x02014b50)error('3MF arşiv dizini bozuk.');
  const flags=buf.readUInt16LE(offset+8),method=buf.readUInt16LE(offset+10);
  const compressed=buf.readUInt32LE(offset+20),uncompressed=buf.readUInt32LE(offset+24);
  const nameLength=buf.readUInt16LE(offset+28),extra=buf.readUInt16LE(offset+30),comment=buf.readUInt16LE(offset+32);
  const localOffset=buf.readUInt32LE(offset+42);
  const name=buf.toString('utf8',offset+46,offset+46+nameLength);
  offset+=46+nameLength+extra+comment;
  if(!/\.model$/i.test(name))continue;
  if(flags&1)error('Şifrelenmiş 3MF açılamıyor.');
  if(uncompressed>MAX_SINGLE_XML||uncompressed>budget)error('3MF modeli önizleme için fazla büyük.');
  if(localOffset+30>buf.length||buf.readUInt32LE(localOffset)!==0x04034b50)error('3MF giriş verisi bozuk.');
  const start=localOffset+30+buf.readUInt16LE(localOffset+26)+buf.readUInt16LE(localOffset+28);
  if(start+compressed>buf.length)error('3MF veri sınırı bozuk.');
  let xml;if(method===0)xml=buf.subarray(start,start+compressed);
  else if(method===8)xml=zlib.inflateRawSync(buf.subarray(start,start+compressed),{maxOutputLength:MAX_SINGLE_XML});
  else continue;
  if(xml.length>budget)error('3MF açılmış veri boyutu fazla büyük.');
  budget-=xml.length;
  models.push(xml.toString('utf8'));
 }
 if(!models.length)error('3MF içinde 3D model bulunamadı.');
 return models;
}
function read3mf(buf){
 const xmlFiles=zipModels(buf);
 const meshBlocks=[];
 const meshRe=/<(?:[\w.-]+:)?mesh\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?mesh\s*>/gi;
 for(const xml of xmlFiles){let match;while((match=meshRe.exec(xml))!==null){meshBlocks.push(match[1]);if(meshBlocks.length>280)error('Çok fazla 3MF parçası.')}}
 if(!meshBlocks.length)error('3MF içinde üçgen geometrisi bulunamadı.');
 const positions=[];
 let allTris=0;
 const budgetPerMesh=Math.max(120,Math.floor(MAX_TRIANGLES/meshBlocks.length));
 for(const block of meshBlocks){
  const vertices=[];let count=0;
  const vRe=/<(?:[\w.-]+:)?vertex\b([^>]*?)\/?\s*>/gi;
  let v;while((v=vRe.exec(block))!==null){
   const x=finiteNumber(attribute(v[1],'x')),y=finiteNumber(attribute(v[1],'y')),z=finiteNumber(attribute(v[1],'z'));
   if(x===null||y===null||z===null)error('3MF nokta koordinatı hatalı.');
   vertices.push(x,z,-y); // 3MF Z-up => Three.js Y-up
   if(++count>MAX_VERTICES)error('3MF modelindeki nokta sayısı sınırı aşıyor.');
  }
  const triangleRe=/<(?:[\w.-]+:)?triangle\b([^>]*?)\/?\s*>/gi;
  let triCount=0;while(triangleRe.exec(block)!==null)triCount++;
  if(triCount===0||count===0)continue;
  let stride=Math.max(1,Math.ceil(triCount/budgetPerMesh));let emitted=0,idx=0,t;
  triangleRe.lastIndex=0;
  while((t=triangleRe.exec(block))!==null){
   if(idx++%stride!==0||emitted>=budgetPerMesh||allTris>=MAX_TRIANGLES)continue;
   const ids=['v1','v2','v3'].map(n=>Number(attribute(t[1],n)));
   if(ids.some(n=>!Number.isInteger(n)||n<0||n>=count))continue;
   for(const id of ids){const o=id*3;positions.push(vertices[o],vertices[o+1],vertices[o+2]);}
   emitted++;allTris++;
  }
  if(allTris>=MAX_TRIANGLES)break;
 }
 if(!allTris)error('3MF üçgenleri okunamadı.');
 return positions;
}
function readStl(buf){
 let triCount=buf.length>=84?buf.readUInt32LE(80):-1;
 let coords=[];
 if(triCount>=0&&84+triCount*50===buf.length){
  const stride=Math.max(1,Math.ceil(triCount/MAX_TRIANGLES));
  for(let i=0;i<triCount;i+=stride){
   const base=84+i*50+12;
   for(let v=0;v<3;v++){
    const off=base+v*12;
    coords.push(buf.readFloatLE(off),buf.readFloatLE(off+8),-buf.readFloatLE(off+4));
   }
  }
 }else{
  const content=buf.toString('utf8');
  const r=/\bvertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g;
  const v=[];let m;while((m=r.exec(content))!==null){v.push(+m[1],+m[3],-(+m[2]));if(v.length>MAX_TRIANGLES*9*16)break}
  const stride=Math.max(1,Math.ceil(v.length/(MAX_TRIANGLES*9)));
  for(let i=0;i+8<v.length;i+=9*stride)coords.push(...v.slice(i,i+9));
 }
 if(coords.length<9)error('STL geometrisi okunamadı.');
 return coords;
}
function glbFromTriangles(coords){
 const count=coords.length/3;
 if(count<3||count>MAX_TRIANGLES*3)error('Üçgen sayısı sınır dışı.');
 const pos=new Float32Array(coords.length),nor=new Float32Array(coords.length);
 const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
 for(let i=0;i<coords.length;i++){const v=coords[i];if(!Number.isFinite(v)||Math.abs(v)>1e8)error('Modelin koordinatları geçersiz.');pos[i]=v;const axis=i%3;min[axis]=Math.min(min[axis],v);max[axis]=Math.max(max[axis],v);}
 for(let i=0;i<coords.length;i+=9){
  const ax=pos[i+3]-pos[i],ay=pos[i+4]-pos[i+1],az=pos[i+5]-pos[i+2];
  const bx=pos[i+6]-pos[i],by=pos[i+7]-pos[i+1],bz=pos[i+8]-pos[i+2];
  let nx=ay*bz-az*by,ny=az*bx-ax*bz,nz=ax*by-ay*bx;
  const size=Math.hypot(nx,ny,nz)||1;nx/=size;ny/=size;nz/=size;
  for(let j=i;j<i+9;j+=3){nor[j]=nx;nor[j+1]=ny;nor[j+2]=nz;}
 }
 const pBuf=Buffer.from(pos.buffer),nBuf=Buffer.from(nor.buffer);
 const bin=Buffer.concat([pBuf,nBuf]);
 const json={asset:{version:'2.0',generator:'ThreeDee safe preview worker'},scene:0,
  scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0,NORMAL:1},material:0,mode:4}]}],
  materials:[{pbrMetallicRoughness:{baseColorFactor:[.77,.72,.64,1],metallicFactor:0,roughnessFactor:.75},doubleSided:true}],
  accessors:[{bufferView:0,componentType:5126,count,type:'VEC3',min,max},{bufferView:1,componentType:5126,count,type:'VEC3'}],
  bufferViews:[{buffer:0,byteOffset:0,byteLength:pBuf.length},{buffer:0,byteOffset:pBuf.length,byteLength:nBuf.length}],buffers:[{byteLength:bin.length}]};
 let j=Buffer.from(JSON.stringify(json));let padding=(4-j.length%4)%4;
 j=Buffer.concat([j,Buffer.alloc(padding,0x20)]);
 const glb=Buffer.alloc(12+8+j.length+8+bin.length);
 glb.writeUInt32LE(0x46546c67,0);glb.writeUInt32LE(2,4);glb.writeUInt32LE(glb.length,8);
 glb.writeUInt32LE(j.length,12);glb.writeUInt32LE(0x4e4f534a,16);j.copy(glb,20);
 const bOffset=20+j.length;glb.writeUInt32LE(bin.length,bOffset);glb.writeUInt32LE(0x004e4942,bOffset+4);bin.copy(glb,bOffset+8);
 return {glb,triangles:count/3};
}
try{
 const source=fs.readFileSync(workerData.source);
 const positions=workerData.format==='3mf'?read3mf(source):readStl(source);
 const result=glbFromTriangles(positions);
 const temp=workerData.target+'.tmp';fs.writeFileSync(temp,result.glb);fs.renameSync(temp,workerData.target);
 parentPort.postMessage({ok:true,triangles:result.triangles,bytes:result.glb.length});
}catch(e){parentPort.postMessage({ok:false,error:String(e.message||e)});}
