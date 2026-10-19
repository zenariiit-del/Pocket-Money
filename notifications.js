(function(){
'use strict';
const $=id=>document.getElementById(id);
let client=null,owner=null,member='',publicKey='',enabled=false,working=false;
let deviceId=localStorage.getItem('family-wallet-device-v1');
if(!deviceId){deviceId=crypto.randomUUID();localStorage.setItem('family-wallet-device-v1',deviceId);}
const hasPush=()=>('serviceWorker'in navigator)&&('PushManager'in window)&&('Notification'in window);
const isIos=()=>/iPhone|iPad|iPod/.test(navigator.userAgent)||(/Mac/.test(navigator.userAgent)&&navigator.maxTouchPoints>1);
const installed=()=>window.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
function note(text,error=false){$('notificationStatus').textContent=text;$('notificationStatus').classList.toggle('negative',error);}
function controls(value){working=value;['notificationMember','enableNotifications','disableNotifications','testNotification','refreshNotifications'].forEach(id=>$(id).disabled=value);}
async function api(action,extra={}){
 if(!client)throw Error('Sign in first.');
 const {data,error}=await client.functions.invoke('wallet-push',{body:{action,device_id:deviceId,...extra}});
 if(error){let detail;try{detail=await error.context.json();}catch{}throw Error(detail?.error||(detail?.message==='Invalid JWT'?'Turn off Verify JWT for the wallet-push function. It verifies signed-in users inside the function.':'Notification setup is incomplete. Follow NOTIFICATIONS_SETUP.txt.'));}
 if(data?.error)throw Error(data.error);
 return data;
}
const appUrl=()=>new URL('./',location.href).href;
async function sync(){
 const data=await api('status');publicKey=data.public_key;enabled=data.enabled;
 if(!member&&data.member){member=data.member;localStorage.setItem('family-wallet-member-'+owner,member);}
 $('notificationMember').value=member;
 if(!hasPush())note('Push is unavailable here. You can still choose your name to notify your partner when you add entries.');
 else if(isIos()&&!installed())note('On iPhone, add this app to the Home Screen and open it there to enable notifications.');
 else if(enabled&&Notification.permission==='granted')note(`Notifications are on for ${member}. Your own entries will not notify you.`);
 else if(Notification.permission==='denied')note('Notifications are blocked. Allow Family Wallet notifications in iPhone Settings, then try again.',true);
 else note(member?'Ready. Enable notifications to receive your partner’s entries.':'Choose who uses this device.');
}
async function registerMember(){
 if(!member)return;
 await api('device',{member,app_url:appUrl()});
}
async function start(db){
 client=db;
 const {data}=await db.auth.getSession();const userId=data?.session?.user?.id;if(!userId||owner===userId)return;
 owner=userId;member=localStorage.getItem('family-wallet-member-'+owner)||'';$('notificationMember').value=member;
 try{await sync();await registerMember();}catch(e){note(e.message,true);}
}
function keyBytes(value){const s=value.replace(/-/g,'+').replace(/_/g,'/');return Uint8Array.from(atob(s+'='.repeat((4-s.length%4)%4)),c=>c.charCodeAt(0));}
async function registration(){
 const reg=await navigator.serviceWorker.register('./service-worker.js?v=3.1');
 const updating=reg.installing||reg.waiting;
 if(updating&&updating.state!=='activated'){
  await Promise.race([new Promise((resolve,reject)=>{updating.addEventListener('statechange',()=>{if(updating.state==='activated')resolve();if(updating.state==='redundant')reject(Error('Notification worker update failed. Reload the app.'));});}),new Promise((_,reject)=>setTimeout(()=>reject(Error('Notification worker is still updating. Reopen the app.')),15000))]);
 }
 return await Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>setTimeout(()=>reject(Error('Notification worker is not ready. Close and reopen the app.')),15000))]);
}
$('notificationMember').onchange=async()=>{
 const previous=member;member=$('notificationMember').value;
 if(!member){member=previous;$('notificationMember').value=previous;note('Choose Ritsuya or honami.');return;}
 localStorage.setItem('family-wallet-member-'+owner,member);controls(true);
 try{await registerMember();await sync();}catch(e){note(e.message,true);}finally{controls(false);}
};
$('enableNotifications').onclick=async()=>{
 if(working)return;
 if(!member)return note('Choose Ritsuya or honami first.',true);
 if(!hasPush())return note('This browser does not support push notifications.',true);
 if(isIos()&&!installed())return note('Add Family Wallet to the Home Screen, open it there, then tap Enable notifications.',true);
 // Request permission directly from the button tap, before asynchronous setup.
 const permissionPromise=Notification.requestPermission();controls(true);
 try{
  const permission=await permissionPromise;
  if(permission!=='granted')throw Error('Notification permission was not granted. Check iPhone notification settings.');
  await sync();const reg=await registration();let subscription=await reg.pushManager.getSubscription();
  if(!subscription)subscription=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:keyBytes(publicKey)});
  await api('subscribe',{member,subscription:subscription.toJSON(),app_url:appUrl()});enabled=true;
  note(`Notifications are on for ${member}. Tap Test notification to check delivery.`);
 }catch(e){note(e.message,true);}finally{controls(false);}
};
async function disable(){
 await api('disable');enabled=false;
 if('serviceWorker'in navigator){const reg=await navigator.serviceWorker.getRegistration();const sub=await reg?.pushManager.getSubscription();if(sub)await sub.unsubscribe();}
 note('Notifications are off on this device. Your saved entries are unchanged.');
}
$('disableNotifications').onclick=async()=>{if(working)return;controls(true);try{await disable();}catch(e){note(e.message,true);}finally{controls(false);}};
$('testNotification').onclick=async()=>{if(working)return;controls(true);try{await api('test');note('Test sent. Check notifications on this device. Focus mode or notification settings may hide the banner.');}catch(e){note(e.message,true);}finally{controls(false);}};
$('refreshNotifications').onclick=async()=>{if(working)return;controls(true);try{await sync();await registerMember();}catch(e){note(e.message,true);}finally{controls(false);}};
let flushTimer;
function flush(){
 clearTimeout(flushTimer);flushTimer=setTimeout(async()=>{
  if(!client||!member)return;
  try{const result=await api('flush');if(result.retry_pending)note('Entry saved. A notification could not be delivered yet; use Retry delivery.',true);}
  catch(e){note('Entry saved. Notification delivery needs attention: '+e.message,true);}
 },1200);
}
$('retryNotifications').onclick=()=>{flush();note('Retrying pending notifications…');};
async function beforeLogout(){clearTimeout(flushTimer);if(client&&member){try{await disable();}catch{}}owner=null;client=null;}
window.WalletNotifications={start,flush,beforeLogout,getDeviceId:()=>deviceId};
})();
