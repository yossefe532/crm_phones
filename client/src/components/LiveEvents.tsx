import { useEffect } from 'react';
import { startLiveEvents } from '../services/liveEvents';

export default function LiveEvents() {
  useEffect(() => {
    if (!localStorage.getItem('token')) return;
    const stop = startLiveEvents((event, data) => {
      if (event === 'invalidate') {
        window.dispatchEvent(new CustomEvent('crm:invalidate', { detail: data }));
        return;
      }
      if (event === 'coach') {
        window.dispatchEvent(new CustomEvent('crm:coach', { detail: data }));
        return;
      }
    });
    return () => stop();
  }, []);

  return null;
}

