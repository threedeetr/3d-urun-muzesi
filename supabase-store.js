'use strict';
// ThreeDee Supabase backend, Node 20+, native fetch (no npm install).
const URL_ROOT = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const API_KEY = process.env.SUPABASE_SECRET_KEY || '';
const enabled = Boolean(URL_ROOT || API_KEY);
if (enabled && (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(URL_ROOT) || !API_KEY)) {
  throw new Error('SUPABASE_URL ve SUPABASE_SECRET_KEY birlikte doğru tanımlanmalı.');
}
const MEDIA = 'museum-media';
const ORIGINALS = 'museum-originals';
const authHeaders = () => ({ apikey: API_KEY, ...(API_KEY.startsWith('eyJ') ? { Authorization: `Bearer ${API_KEY}` } : {}) });
const encode = encodeURIComponent;
function errorFromResponse(res, body) {
  const msg = typeof body === 'string' ? body : (body && (body.message || body.error || body.hint || body.code));
  const err = new Error(`Supabase ${res.status}: ${String(msg || res.statusText).slice(0,350)}`);
  err.status = res.status === 429 ? 503 : 502;
  return err;
}
async function request(url, { method='GET', body, headers={} } = {}) {
  const isBinary = Buffer.isBuffer(body) || body instanceof Uint8Array;
  const response = await fetch(url, {
    method,
    headers: { ...authHeaders(), ...(body != null && !isBinary ? {'Content-Type':'application/json'} : {}), ...headers },
    body: body == null ? undefined : isBinary ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(25000)
  });
  const raw = await response.text();
  let data; try { data = raw ? JSON.parse(raw) : null; } catch {data=raw;}
  if (!response.ok) throw errorFromResponse(response,data);
  return { data, headers:response.headers, status:response.status };
}
function table(name, query='') { return `${URL_ROOT}/rest/v1/${name}${query}`; }
function dataRows(rows) { return rows.map(x=>x.payload); }
async function listProducts() {
  const rows=[];
  for(let offset=0; offset<10000; offset+=500) {
    const {data}=await request(table('museum_products',`?select=payload&order=created_at.asc&offset=${offset}&limit=500`));
    rows.push(...dataRows(data));if(data.length<500)break;
  }
  return rows;
}
async function upsertProduct(product) {
  await request(table('museum_products','?on_conflict=id'), {method:'POST',body:{id:product.id,created_at:product.createdAt || new Date().toISOString(),payload:product},headers:{Prefer:'resolution=merge-duplicates,return=minimal'}});
}
async function deleteProduct(id){await request(table('museum_products',`?id=eq.${encode(id)}`),{method:'DELETE'});}
function reviewFromDb(r){return {id:r.id,scope:r.scope,productId:r.product_id,name:r.name,message:r.message,rating:r.rating,createdAt:r.created_at};}
function reviewToDb(r){return {id:r.id,scope:r.scope,product_id:r.productId || null,name:r.name,message:r.message,rating:r.rating,created_at:r.createdAt};}
function reviewWhere(scope,productId){return `${scope?'&scope=eq.'+encode(scope):''}${productId?'&product_id=eq.'+encode(productId):''}`;}
async function reviewsPage({scope,productId,page=1,limit=10}={}) {
 const n=Math.max(1,Math.min(100000,Number(page)||1));
 const path=table('museum_reviews',`?select=id,scope,product_id,name,message,rating,created_at&order=created_at.desc&offset=${(n-1)*limit}&limit=${limit}${reviewWhere(scope,productId)}`);
 const {data,headers}=await request(path,{headers:{Prefer:'count=exact'}});
 const range=headers.get('content-range')||'';
 const total=Number(range.split('/')[1]);
 return {items:data.map(reviewFromDb),total:Number.isFinite(total)?total:data.length,page:n,hasMore: Number.isFinite(total)?n*limit<total:data.length===limit};
}
async function reviewsAll(){
 const out=[];
 for(let page=1;page<=20;page++) {const result=await reviewsPage({page,limit:500});out.push(...result.items);if(!result.hasMore)break;}
 return out;
}
async function recentReviews(limit=200){return (await reviewsPage({limit})).items;}
async function createReview(review){
 await request(table('museum_reviews'),{method:'POST',body:reviewToDb(review),headers:{Prefer:'return=minimal'}});
}
async function upsertReviews(reviews){
 for(let i=0;i<reviews.length;i+=100){await request(table('museum_reviews','?on_conflict=id'),{method:'POST',body:reviews.slice(i,i+100).map(reviewToDb),headers:{Prefer:'resolution=merge-duplicates,return=minimal'}});}
}
async function removeReview(id){await request(table('museum_reviews',`?id=eq.${encode(id)}`),{method:'DELETE'});}
async function removeReviewsForProduct(id){await request(table('museum_reviews',`?product_id=eq.${encode(id)}`),{method:'DELETE'});}
async function ratings(){
 const {data}=await request(table('museum_product_ratings','?select=product_id,count,average&limit=10000'));
 return Object.fromEntries(data.map(x=>[x.product_id,{count:Number(x.count)||0,average:Number(x.average)||0}]));
}
function publicUrl(key){return `${URL_ROOT}/storage/v1/object/public/${MEDIA}/${encode(key)}`;}
function isOurPublicUrl(url){try {const u=new URL(url);return u.origin===URL_ROOT&&u.pathname.startsWith(`/storage/v1/object/public/${MEDIA}/`);}catch{return false;}}
function objectRef(url){
 if(typeof url!=='string')return null;
 if(url.startsWith(`storage://${ORIGINALS}/`))return {bucket:ORIGINALS,key:url.slice(`storage://${ORIGINALS}/`.length)};
 if(isOurPublicUrl(url))return {bucket:MEDIA,key:decodeURIComponent(new URL(url).pathname.split('/').pop())};
 return null;
}
async function uploadObject(bucket,key,content,contentType){
 const result=await request(`${URL_ROOT}/storage/v1/object/${bucket}/${encode(key)}`,{method:'POST',body:content,headers:{'Content-Type':contentType,'x-upsert':'false','cache-control':'3600'}});
 return bucket===MEDIA ? publicUrl(key) : `storage://${ORIGINALS}/${key}`;
}
async function downloadObject(url){
 const object=objectRef(url);if(!object)throw new Error('Bu dosya Supabase deposunda değil.');
 const response=await fetch(`${URL_ROOT}/storage/v1/object/authenticated/${object.bucket}/${encode(object.key)}`,{headers:authHeaders(),signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw errorFromResponse(response,await response.text());
 return Buffer.from(await response.arrayBuffer());
}
async function deleteObject(url){
 const object=objectRef(url);if(!object)return;
 await request(`${URL_ROOT}/storage/v1/object/${object.bucket}/${encode(object.key)}`,{method:'DELETE'});
}
async function check(){
 await request(table('museum_products','?select=id&limit=1'));
 await request(table('museum_reviews','?select=id&limit=1'));
 await request(table('museum_product_ratings','?select=product_id&limit=1'));
}
module.exports = {enabled,MEDIA,ORIGINALS,listProducts,upsertProduct,deleteProduct,reviewsPage,reviewsAll,recentReviews,createReview,upsertReviews,removeReview,removeReviewsForProduct,ratings,uploadObject,deleteObject,downloadObject,publicUrl,objectRef,check};
