import { useRegisterSW } from 'virtual:pwa-register/react';
import { RefreshCw } from 'lucide-react';

/**
 * Offers the new version once it has downloaded.
 *
 * The app is precached, so a deploy does not reach anyone still holding a tab
 * open: the new files arrive in the background but the page keeps running the
 * code it started with until it reloads. That has caused real confusion twice -
 * a button that did nothing because the room had never heard of it, and a host
 * naming dialog that only appeared after a hard refresh. Better to say so.
 */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      // Someone may sit on one game all evening, so look again now and then.
      if (registration) setInterval(() => void registration.update(), 60 * 60 * 1000);
    },
  });

  if (!needRefresh) return null;

  return (
    <div className="update-prompt" role="status">
      <span>A newer version is ready.</span>
      <button type="button" className="primary" onClick={() => void updateServiceWorker(true)}>
        <RefreshCw size={15} aria-hidden="true" /> Refresh
      </button>
    </div>
  );
}
