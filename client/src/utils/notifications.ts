import api from '../services/api';

const VAPID_PUBLIC_KEY = 'BK665nDCkemcBHRi4zoLPr3bE5nq3shPKrtzSVFZdZ9R2Taf-ZkffjHX4aH1_wbItmvXB5Xz-jbGoTKuU9W3H9g';

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
    
    if (existingSubscription) {
      // Check if keys are still valid or just resubscribe to be sure
      // return existingSubscription;
    }

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      console.warn('Notification permission denied');
      return;
    }

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });

    await api.post('/notifications/subscribe', subscription);
    console.log('Successfully subscribed to push notifications');
  } catch (error) {
    console.error('Error subscribing to push notifications:', error);
  }
}
