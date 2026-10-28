/* WellDose push worker. Does not cache or store health information. */
self.addEventListener('push',event=>{
  let data={};
  try { data=event.data?event.data.json():{}; } catch { /* generic notification */ }
  event.waitUntil(self.registration.showNotification('WellDose hatırlatması',{
    body:'Planladığın bir hatırlatmanın zamanı geldi. WellDose’u kontrol et.',
    icon:'/icon-192.png',badge:'/icon-192.png',tag:String(data.tag||'welldose-reminder'),
    data:{url:'/'},renotify:false,
  }));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil((async()=>{
    const clientsList=await clients.matchAll({type:'window',includeUncontrolled:true});
    const existing=clientsList.find(client=>new URL(client.url).origin===self.location.origin);
    if(existing){await existing.focus();return;}
    await clients.openWindow('/');
  })());
});
