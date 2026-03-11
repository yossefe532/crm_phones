self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : { title: 'إشعار جديد', body: 'لديك إشعار جديد من نظام CRM' };
  
  const options = {
    body: data.body,
    icon: data.icon || '/icon-192.png',
    badge: '/icon-192.png',
    data: data.data,
    vibrate: [100, 50, 100],
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow('/')
  );
});
