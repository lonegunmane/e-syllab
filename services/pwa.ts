/**
 * E-SYLLAB PWA Manager
 * Handles Service Worker registration, PWA install prompt lifecycle,
 * and update detection / refresh flows.
 */

export interface PwaState {
  isInstalled: boolean;
  isInstallable: boolean;
  hasUpdate: boolean;
}

let deferredInstallPrompt: any = null;
let isRefreshing = false;

/**
 * Checks if the application is currently running in standalone (installed) mode.
 */
export function isStandaloneMode(): boolean {
  if (typeof window === 'undefined') return false;

  const isStandaloneMedia = window.matchMedia('(display-mode: standalone)').matches;
  const isIosStandalone = (navigator as any).standalone === true;
  const isAndroidReferrer = document.referrer.includes('android-app://');

  return isStandaloneMedia || isIosStandalone || isAndroidReferrer;
}

/**
 * Initializes the PWA service worker registration, install prompt listeners,
 * and update notifications.
 */
export function initPwa() {
  if (typeof window === 'undefined') return;

  const installBanner = document.getElementById('install-banner');
  const installBtn = document.getElementById('install-btn');
  const dismissBtn = document.getElementById('dismiss-btn');

  const updateBanner = document.getElementById('update-banner');
  const updateBtn = document.getElementById('update-btn');
  const updateDismissBtn = document.getElementById('update-dismiss-btn');

  // 1. Standalone / Installed Check
  if (isStandaloneMode()) {
    console.log('[PWA] Running in standalone (installed) mode.');
    if (installBanner) {
      installBanner.classList.remove('show');
      installBanner.style.display = 'none';
    }
  }

  // 2. Install Prompt Listener
  window.addEventListener('beforeinstallprompt', (e: Event) => {
    // Prevent browser's default mini-infobar
    e.preventDefault();
    deferredInstallPrompt = e;
    console.log('[PWA] Captured beforeinstallprompt event');

    // Only show if not in standalone mode and user hasn't dismissed recently
    if (isStandaloneMode()) {
      if (installBanner) installBanner.style.display = 'none';
      return;
    }

    const dismissedTime = localStorage.getItem('esyllab-pwa-dismissed-time');
    const hasDismissedRecently = dismissedTime && (Date.now() - parseInt(dismissedTime, 10) < 3 * 24 * 60 * 60 * 1000);

    if (!hasDismissedRecently && installBanner) {
      setTimeout(() => {
        if (!isStandaloneMode() && deferredInstallPrompt && installBanner) {
          installBanner.classList.add('show');
        }
      }, 2500);
    }
  });

  // Wire Install Button
  if (installBtn) {
    installBtn.addEventListener('click', async () => {
      if (!deferredInstallPrompt) {
        console.warn('[PWA] No deferred install prompt available');
        return;
      }
      if (installBanner) installBanner.classList.remove('show');

      try {
        console.log('[PWA] Triggering install prompt dialog...');
        deferredInstallPrompt.prompt();
        const choiceResult = await deferredInstallPrompt.userChoice;
        console.log('[PWA] User response to install prompt:', choiceResult?.outcome);
      } catch (err) {
        console.error('[PWA] Error during install prompt:', err);
      } finally {
        deferredInstallPrompt = null;
      }
    });
  }

  // Wire Dismiss Button
  if (dismissBtn) {
    dismissBtn.addEventListener('click', () => {
      if (installBanner) installBanner.classList.remove('show');
      localStorage.setItem('esyllab-pwa-dismissed-time', Date.now().toString());
      console.log('[PWA] Install prompt dismissed by user');
    });
  }

  // App Installed Event
  window.addEventListener('appinstalled', () => {
    console.log('[PWA] E-SYLLAB installed successfully');
    deferredInstallPrompt = null;
    if (installBanner) {
      installBanner.classList.remove('show');
      installBanner.style.display = 'none';
    }
  });

  // 3. Service Worker Registration & Update-Detection Flow
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js');
        console.log('[PWA] Service Worker registered successfully with scope:', registration.scope);

        // Helper to prompt user for update
        const showUpdateBanner = (waitingWorker: ServiceWorker) => {
          console.log('[PWA] New service worker version waiting — displaying update banner');
          if (!updateBanner) return;

          updateBanner.classList.add('show');

          const applyUpdate = () => {
            console.log('[PWA] User requested update refresh. Sending SKIP_WAITING...');
            try {
              waitingWorker.postMessage({ type: 'SKIP_WAITING' });
            } catch (err) {
              console.warn('[PWA] Failed to post message to waiting worker:', err);
            }
            if (updateBanner) updateBanner.classList.remove('show');
          };

          if (updateBtn) {
            updateBtn.onclick = (e) => {
              e.stopPropagation();
              applyUpdate();
            };
          }

          // Clicking anywhere on the banner (except the dismiss 'x') triggers update
          updateBanner.onclick = (e) => {
            if (
              e.target === updateDismissBtn || 
              (updateDismissBtn && updateDismissBtn.contains(e.target as Node))
            ) {
              return;
            }
            applyUpdate();
          };

          if (updateDismissBtn) {
            updateDismissBtn.onclick = (e) => {
              e.stopPropagation();
              updateBanner.classList.remove('show');
              console.log('[PWA] Update banner dismissed by user');
            };
          }
        };

        // Reload the page once the new service worker takes controller status
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (isRefreshing) return;
          isRefreshing = true;
          console.log('[PWA] Controller changed — reloading page with updated content...');
          window.location.reload();
        });

        // Case A: A service worker is already waiting in background
        if (registration.waiting) {
          showUpdateBanner(registration.waiting);
        }

        // Case B: An update is found during this or subsequent sessions
        registration.addEventListener('updatefound', () => {
          const installingWorker = registration.installing;
          if (!installingWorker) return;

          console.log('[PWA] Service Worker update found. Installing...');

          installingWorker.addEventListener('statechange', () => {
            if (
              installingWorker.state === 'installed' && 
              navigator.serviceWorker.controller
            ) {
              console.log('[PWA] New version installed and waiting');
              showUpdateBanner(installingWorker);
            }
          });
        });

        // Check for updates on tab focus
        window.addEventListener('focus', () => {
          registration.update().catch(() => {});
        });

      } catch (err) {
        console.error('[PWA] Service Worker registration failed:', err);
      }
    });
  } else {
    console.log('[PWA] Service Workers are not supported in this browser.');
  }
}
