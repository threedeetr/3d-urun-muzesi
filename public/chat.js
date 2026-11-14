'use strict';
// ThreeDee V7 common-room chat. Safe DOM text nodes; no user HTML is inserted.
(()=>{
 const $=id=>document.getElementById(id);
 const toggle=$('chatToggle'),panel=$('chatPanel'),messages=$('chatMessages');
 if(!toggle||!panel||!messages)return;
 let open=false,loading=false,sending=false,timer=null,lastSeen='',known=new Set(),guest=true,backoff=0,lastFull=0;
 const state=$('chatFeedback');
 const api=async(url,method='GET',payload)=>{
  const response=await fetch(url,{method,credentials:'same-origin',cache:'no-store',headers:payload===undefined?{}:{'Content-Type':'application/json'},body:payload===undefined?undefined:JSON.stringify(payload)});
  const data=await response.json().catch(()=>({}));if(!response.ok)throw Error(data.error||'Bağlantı hatası.');return data;
 };
 function feedback(msg){state.textContent=msg||'';}
 const formatTime=t=>{try{return new Intl.DateTimeFormat('tr-TR',{hour:'2-digit',minute:'2-digit'}).format(new Date(t))}catch{return ''}};
 function renderMessage(m){
  const item=document.createElement('article');item.className='chat-item';item.dataset.chatId=m.id;
  const head=document.createElement('div');head.className='chat-item-head';
  const name=document.createElement('strong');name.textContent=String(m.nickname||'Ziyaretçi').slice(0,25);
  const time=document.createElement('time');time.dateTime=m.createdAt;time.textContent=formatTime(m.createdAt);
  head.append(name,time);
  const body=document.createElement('p');body.textContent=String(m.body||'');
  item.append(head,body);return item;
 }
 function appendRows(rows){
  const nearEnd=messages.scrollHeight-messages.scrollTop-messages.clientHeight<100;
  let appended=0;
  for(const m of rows){
   if(!m?.id||known.has(m.id))continue;
   known.add(m.id);messages.append(renderMessage(m));appended++;
   if(!lastSeen||new Date(m.createdAt)>new Date(lastSeen))lastSeen=m.createdAt;
  }
  while(messages.children.length>90){const old=messages.firstElementChild;old.remove();}
  if(known.size>1000)known=new Set([...known].slice(-200));
  if(nearEnd)messages.scrollTop=messages.scrollHeight;
  if(appended&&!open)$('chatUnread').hidden=false;
  return appended;
 }
 async function checkLogin(){
  try{const r=await api('/api/customer/session');guest=!r.authenticated}
  catch{guest=true}
  $('chatForm').hidden=guest;$('chatSignIn').hidden=!guest;
 }
 async function refresh(){
  if(!open||document.visibilityState==='hidden'||loading)return;
  loading=true;
  try{
   const full=!lastSeen||Date.now()-lastFull>20000;
   const query=!full&&lastSeen?`?after=${encodeURIComponent(lastSeen)}`:'';
   const r=await api('/api/chat/messages'+query);
   if(full){
     lastFull=Date.now();
     const currentIds=new Set((r.messages||[]).map(m=>m.id));
     for(const el of [...messages.children])if(!currentIds.has(el.dataset.chatId))el.remove();
     known=new Set([...messages.children].map(el=>el.dataset.chatId));
     lastSeen=[...messages.children].reduce((max,el)=>{const t=el.querySelector('time')?.dateTime;return t&&t>max?t:max},'');
   }
   appendRows(r.messages||[]);backoff=0;
   if(!messages.children.length){messages.textContent='Henüz mesaj yok. İlk selamı sen ver!';}
   else if(messages.firstChild?.nodeType===3)messages.firstChild.remove();
   feedback('');
  }catch(err){feedback(err.message);backoff=Math.min(15000,backoff+3000)}
  finally{loading=false}
 }
 function schedule(){if(timer)clearInterval(timer);timer=setInterval(()=>{if(open)refresh()},Math.max(3500,backoff||3500));}
 async function show(){
  open=true;panel.hidden=false;toggle.setAttribute('aria-expanded','true');toggle.classList.add('open');$('chatUnread').hidden=true;
  await Promise.all([refresh(),checkLogin()]);schedule();
 }
 function hide(){open=false;panel.hidden=true;toggle.setAttribute('aria-expanded','false');toggle.classList.remove('open');if(timer){clearInterval(timer);timer=null}}
 async function submit(e){
  e.preventDefault();if(sending)return;
  const input=$('chatInput'),value=input.value.trim();if(!value)return;
  sending=true;$('chatSend').disabled=true;feedback('');
  try{
   const r=await api('/api/chat/messages','POST',{message:value});
   if(messages.firstChild?.nodeType===3)messages.firstChild.remove();
   appendRows([r.message]);input.value='';input.focus();
  }catch(err){feedback(err.message);if(err.message.includes('giriş'))await checkLogin()}
  finally{sending=false;$('chatSend').disabled=false}
 }
 toggle.onclick=()=>open?hide():show();$('chatClose').onclick=hide;
 $('chatForm').onsubmit=submit;
 $('chatSignIn').onclick=()=>{hide();$('shopAccount')?.click()};
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&open){e.stopPropagation();hide()}});
 document.addEventListener('visibilitychange',()=>{if(open&&document.visibilityState==='visible'){refresh();checkLogin()}});
})();
