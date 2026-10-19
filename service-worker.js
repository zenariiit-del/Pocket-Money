// Personal records and authentication are never cached by this worker.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('push',event=>{
 let data={};try{data=event.data?.json()||{};}catch{}
 const scope=new URL(self.registration.scope);
 let target=scope.href;try{const candidate=new URL(data.url||scope.href);if(candidate.origin===scope.origin&&candidate.pathname.startsWith(scope.pathname))target=candidate.href;}catch{}
 const url=new URL(target);
 if(data.source==='allowance'||data.source==='household')url.searchParams.set('view',data.source);
 if(typeof data.month==='string'&&/^\d{4}-\d{2}$/.test(data.month))url.searchParams.set('month',data.month);
 event.waitUntil(self.registration.showNotification(data.title||'Family Wallet',{
  body:data.body||'A new family entry was added.',
  icon:new URL('icons/icon-192.png',scope).href,
  tag:data.tag||'wallet-update',
  data:{url:url.href}
 }));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 event.waitUntil((async()=>{
  const scope=new URL(self.registration.scope);let url=scope.href;
  try{const candidate=new URL(event.notification.data?.url||scope.href);if(candidate.origin===scope.origin&&candidate.pathname.startsWith(scope.pathname))url=candidate.href;}catch{}
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  for(const client of windows){if(client.url.startsWith(scope.href)){await client.navigate(url);return client.focus();}}
  return self.clients.openWindow(url);
 })());
});
