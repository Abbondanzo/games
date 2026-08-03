/**
 * Stands in for virtual:pwa-register/react, which only exists when Vite builds
 * with the PWA plugin. Under test there is no service worker, so nothing is
 * ever waiting to be installed.
 */
export const useRegisterSW = () => ({
  needRefresh: [false, () => {}] as [boolean, (value: boolean) => void],
  offlineReady: [false, () => {}] as [boolean, (value: boolean) => void],
  updateServiceWorker: async () => {},
});
