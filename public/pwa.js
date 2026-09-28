(() => {
  const dialog = document.querySelector('#pwaInstallDialog');
  if (!dialog) return;

  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/i.test(navigator.userAgent);
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches
    || navigator.standalone === true;
  const deferredPromptKey = 'durmo-pwa-install-dismissed-until';
  const installButton = document.querySelector('#installAppButton');
  const dismissButton = document.querySelector('#dismissInstallPrompt');
  const description = document.querySelector('#pwaInstallDescription');
  const iosSteps = document.querySelector('#iosInstallSteps');
  const androidHelp = document.querySelector('#androidInstallHelp');
  const installLinks = [
    document.querySelector('#openInstallPrompt'),
    document.querySelector('#installAppTopbar'),
  ].filter(Boolean);
  let installPromptEvent = null;

  if (isIOS) dismissButton.textContent = 'Entendi';

  function setInstallLinksVisible(visible) {
    installLinks.forEach((button) => button.classList.toggle('hidden', !visible));
  }

  function updateInstructions(showFallback = false) {
    iosSteps.classList.toggle('hidden', !isIOS);
    androidHelp.classList.toggle('hidden', isIOS || !showFallback);
    if (isIOS) {
      description.textContent = 'Adicione o DURMO à tela inicial para abrir seu diário como um app.';
      installButton.classList.add('hidden');
      return;
    }

    description.textContent = 'Instale o DURMO no celular para abrir seu diário direto pela tela inicial.';
    installButton.classList.toggle('hidden', showFallback);
    androidHelp.textContent = 'No Chrome, abra o menu ⋮ e escolha “Instalar app” ou “Adicionar à tela inicial”.';
  }

  function openPrompt({ automatic = false } = {}) {
    if (isStandalone()) return;
    updateInstructions(false);
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    dialog.dataset.automatic = String(automatic);
  }

  function closePrompt({ snooze = false } = {}) {
    if (snooze) {
      const snoozeUntil = Date.now() + 7 * 24 * 60 * 60 * 1000;
      try { localStorage.setItem(deferredPromptKey, String(snoozeUntil)); } catch {}
    }
    if (typeof dialog.close === 'function' && dialog.open) dialog.close();
    else dialog.removeAttribute('open');
  }

  function snoozed() {
    try {
      const until = Number(localStorage.getItem(deferredPromptKey) || 0);
      if (until > Date.now()) return true;
      localStorage.removeItem(deferredPromptKey);
    } catch {}
    return false;
  }

  document.querySelector('#closeInstallPrompt').addEventListener('click', () => closePrompt({ snooze: true }));
  document.querySelector('#dismissInstallPrompt').addEventListener('click', () => closePrompt({ snooze: true }));
  installLinks.forEach((button) => button.addEventListener('click', () => openPrompt()));

  installButton.addEventListener('click', async () => {
    if (!installPromptEvent) {
      updateInstructions(true);
      return;
    }
    installButton.disabled = true;
    installPromptEvent.prompt();
    await installPromptEvent.userChoice;
    installPromptEvent = null;
    installButton.disabled = false;
    closePrompt({ snooze: true });
  });

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPromptEvent = event;
    if (!isIOS) {
      installLinks.forEach((button) => button.classList.remove('hidden'));
    }
  });

  window.addEventListener('appinstalled', () => {
    closePrompt();
    setInstallLinksVisible(false);
    try { localStorage.setItem(deferredPromptKey, String(Date.now() + 365 * 24 * 60 * 60 * 1000)); } catch {}
  });

  if ('serviceWorker' in navigator && window.isSecureContext) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch((error) => {
        console.warn('Não foi possível preparar o DURMO para uso offline:', error);
      });
    }, { once: true });
  }

  if (isStandalone()) {
    setInstallLinksVisible(false);
  } else {
    setInstallLinksVisible(true);
    if (!snoozed()) window.setTimeout(() => openPrompt({ automatic: true }), 900);
  }
})();
