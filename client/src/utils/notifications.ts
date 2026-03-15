import api from '../services/api';

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export async function subscribeToPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.warn('Push notifications are not supported in this browser');
    return;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    const existingSubscription = await registration.pushManager.getSubscription();
    
    if (Notification.permission === 'denied') {
      console.warn('Notification permission denied');
      return;
    }

    const permission = Notification.permission === 'granted'
      ? 'granted'
      : await Notification.requestPermission();
    if (permission !== 'granted') return;

    const keyRes = await api.get('/notifications/vapid-public-key').catch(() => null);
    const publicKey = keyRes?.data?.publicKey;
    if (!publicKey || typeof publicKey !== 'string') {
      console.warn('VAPID public key is missing. Push notifications are disabled on server.');
      return;
    }

    const subscription = existingSubscription || await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });

    await api.post('/notifications/subscribe', subscription);
  } catch (error) {
    console.error('Error subscribing to push notifications:', error);
  }
}
