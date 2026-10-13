(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  // One native element stays mounted across app sections. No WebAudio graph,
  // background JS timer, blob download or visibility-triggered pause.
  const audio = $('sleepAudio');
  let tracks = [];
  let selected = null;
  let sourceId = null;
  let loading = false;
  let pendingPlay = false;
  let visible = false;
  let seeking = false;
  let generation = 0;
  let catalogueRequest = null;
  let sessionReady = false;

  function time(value) {
    const seconds = Math.max(0, Math.floor(Number(value) || 0));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }

  function status(message) { $('audioStatus').textContent = message; }

  function duration() {
    return Number.isFinite(audio.duration) ? audio.duration : selected?.duration || 1800;
  }

  function updatePosition() {
    const position = audio.currentTime || 0;
    if (!seeking) {
      $('audioSeek').value = position;
      $('audioElapsed').textContent = time(position);
    }
    $('audioSeek').max = duration();
    $('audioSeek').setAttribute('aria-valuetext', `${time(seeking ? $('audioSeek').value : position)} de ${time(duration())}`);
    $('audioDuration').textContent = time(duration());
    if (sessionReady && navigator.mediaSession?.setPositionState && Number.isFinite(audio.duration) && audio.duration > 0) {
      try {
        navigator.mediaSession.setPositionState({
          duration: audio.duration, playbackRate: audio.playbackRate,
          position: Math.min(position, audio.duration),
        });
      } catch { /* Some browsers expose the API but reject position updates. */ }
    }
  }

  function render() {
    const active = !audio.paused && !audio.ended;
    const label = pendingPlay ? 'Cancelar' : active ? 'Pausar' : 'Reproduzir';
    $('audioPlayLabel').textContent = label;
    $('audioPlayIcon').textContent = active || pendingPlay ? 'Ⅱ' : '▶';
    $('audioPlay').disabled = !selected;
    $('audioPlay').setAttribute('aria-label', `${label} ${selected?.title || 'áudio'}`);
    $('audioTitle').textContent = selected?.title || 'Escolha seu áudio';
    $('audioMiniTitle').textContent = selected?.title || 'DURMO';
    $('audioMiniPlay').textContent = label;
    $('audioMiniPlay').setAttribute('aria-label', `${label} áudio`);
    $('audioMiniState').textContent = pendingPlay ? 'Carregando…' : active ? 'Reproduzindo' : 'Pausado';
    $('audioMini').classList.toggle('hidden', visible || !sourceId);
    const canSeek = Boolean(sourceId && audio.readyState >= 1);
    ['audioSeek', 'audioBack', 'audioForward'].forEach((id) => { $(id).disabled = !canSeek; });
    document.querySelectorAll('.audio-track').forEach((button) => {
      const chosen = button.dataset.id === selected?.id;
      button.setAttribute('aria-pressed', String(chosen));
      button.classList.toggle('selected', chosen);
    });
    if (sessionReady) {
      try { navigator.mediaSession.playbackState = active ? 'playing' : 'paused'; } catch {}
    }
    updatePosition();
  }

  async function load() {
    if (tracks.length || loading) return;
    loading = true;
    catalogueRequest = new AbortController();
    const request = catalogueRequest;
    status('Carregando os áudios…');
    $('audioRetry').classList.add('hidden');
    try {
      const response = await fetch('/api/audio', { signal: request.signal });
      if (!response.ok) throw new Error(response.status === 401
        ? 'Sua sessão terminou. Entre novamente para ouvir.'
        : 'Não foi possível carregar os áudios. Tente novamente.');
      const data = await response.json();
      if (request.signal.aborted) return;
      tracks = data.tracks;
      $('audioTracks').replaceChildren();
      for (const track of tracks) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'audio-track';
        button.dataset.id = track.id;
        const mark = document.createElement('span');
        mark.className = 'audio-track-mark';
        mark.textContent = '☾';
        mark.setAttribute('aria-hidden', 'true');
        const copy = document.createElement('span');
        const title = document.createElement('strong');
        title.textContent = track.title;
        const detail = document.createElement('small');
        detail.textContent = '30 min · Relaxamento';
        copy.append(title, detail);
        button.append(mark, copy);
        button.addEventListener('click', () => select(track));
        $('audioTracks').append(button);
      }
      if (!tracks.length) throw new Error('Os áudios ainda não estão disponíveis. Tente novamente.');
      select(tracks[0]);
      status('Toque em Reproduzir quando estiver pronto(a).');
    } catch (error) {
      if (request.signal.aborted) return;
      status(error.message || 'Confira sua conexão e tente novamente.');
      $('audioRetry').classList.remove('hidden');
    } finally {
      if (catalogueRequest === request) {
        loading = false;
        catalogueRequest = null;
      }
    }
  }

  function clearSession() {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.playbackState = 'none';
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.setPositionState?.();
    } catch {}
    for (const action of ['play', 'pause', 'stop', 'seekbackward', 'seekforward', 'seekto', 'previoustrack', 'nexttrack']) {
      try { navigator.mediaSession.setActionHandler(action, null); } catch {}
    }
    sessionReady = false;
  }

  function stop() {
    generation += 1;
    pendingPlay = false;
    sourceId = null;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    clearSession();
    status('Reprodução encerrada.');
    render();
  }

  function select(track) {
    if (selected?.id === track.id) return;
    const wasPlaying = !audio.paused || pendingPlay;
    if (sourceId) stop();
    selected = track;
    status('Toque em Reproduzir quando estiver pronto(a).');
    render();
    // Track switching during playback is still inside the user's click gesture.
    if (wasPlaying) play();
  }

  function seek(value) {
    if (!sourceId || audio.readyState < 1) return;
    audio.currentTime = Math.max(0, Math.min(duration(), value));
    updatePosition();
  }

  function activateSession() {
    if (!('mediaSession' in navigator)) return;
    if ('MediaMetadata' in window) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: selected.title, artist: 'DURMO', album: 'Áudios para relaxar',
        artwork: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      });
    }
    const actions = {
      play, pause,
      stop,
      seekbackward: (event) => seek(audio.currentTime - (event.seekOffset || 15)),
      seekforward: (event) => seek(audio.currentTime + (event.seekOffset || 15)),
      seekto: (event) => seek(event.seekTime),
    };
    for (const [action, handler] of Object.entries(actions)) {
      try { navigator.mediaSession.setActionHandler(action, handler); } catch {}
    }
    sessionReady = true;
  }

  async function play() {
    if (!selected) return;
    const attempt = ++generation;
    pendingPlay = true;
    status('Preparando seu áudio…');
    // Safari's Audio Session API is optional; HTMLAudioElement is the fallback.
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {}
    if (sourceId !== selected.id) {
      sourceId = selected.id;
      audio.src = selected.url;
      audio.load();
    }
    if (audio.ended) audio.currentTime = 0;
    activateSession();
    render();
    try {
      // Call play synchronously after the tap (before awaiting any network work).
      await audio.play();
      if (attempt !== generation) return;
      pendingPlay = false;
      status('Pode bloquear a tela e descansar.');
      render();
    } catch (error) {
      if (attempt !== generation) return;
      pendingPlay = false;
      status(error.name === 'NotAllowedError'
        ? 'Toque novamente em Reproduzir. Se necessário, abra no Safari ou Chrome.'
        : 'Não foi possível tocar. Confira sua conexão ou entre novamente e tente reproduzir.');
      sourceId = null;
      audio.removeAttribute('src');
      audio.load();
      clearSession();
      render();
    }
  }

  function pause() {
    generation += 1;
    pendingPlay = false;
    audio.pause();
    status('Pausado. Continue quando quiser.');
    render();
  }

  function toggle() {
    if (pendingPlay || !audio.paused) pause();
    else play();
  }

  $('audioPlay').addEventListener('click', toggle);
  $('audioMiniPlay').addEventListener('click', toggle);
  $('audioStop').addEventListener('click', stop);
  $('audioMiniOpen').addEventListener('click', () => {
    document.querySelector('.view-tab[data-view="audio"]').click();
  });
  $('audioRetry').addEventListener('click', load);
  $('audioBack').addEventListener('click', () => seek(audio.currentTime - 15));
  $('audioForward').addEventListener('click', () => seek(audio.currentTime + 15));
  $('audioSeek').addEventListener('input', () => {
    seeking = true;
    $('audioElapsed').textContent = time($('audioSeek').value);
    updatePosition();
  });
  $('audioSeek').addEventListener('change', () => {
    seeking = false;
    seek(Number($('audioSeek').value));
  });
  $('audioLoop').addEventListener('click', () => {
    audio.loop = !audio.loop;
    renderLoop();
  });

  function renderLoop() {
    $('audioLoop').setAttribute('aria-pressed', String(audio.loop));
    $('audioLoop').textContent = audio.loop ? '↻ Repetição ativada' : '↻ Repetição desativada';
    $('audioLoopHelp').textContent = audio.loop
      ? 'Ao terminar, o áudio recomeça com uma transição suave.'
      : 'O áudio termina ao completar os 30 minutos.';
  }

  for (const event of ['loadedmetadata', 'durationchange', 'seeked', 'pause', 'play', 'ended', 'emptied']) {
    audio.addEventListener(event, render);
  }
  audio.addEventListener('timeupdate', updatePosition);
  audio.addEventListener('waiting', () => { if (sourceId && !audio.paused) status('Carregando mais áudio…'); });
  audio.addEventListener('playing', () => {
    pendingPlay = false;
    status('Pode bloquear a tela e descansar.');
    render();
  });
  audio.addEventListener('ended', () => status('Áudio concluído.'));
  audio.addEventListener('error', () => {
    if (!sourceId || !audio.error) return;
    generation += 1;
    pendingPlay = false;
    sourceId = null;
    clearSession();
    status('O áudio foi interrompido. Confira sua conexão ou entre novamente e toque em Reproduzir.');
    render();
  });

  window.DurmoAudio = {
    load,
    setVisible(value) { visible = value; render(); },
    reset() {
      catalogueRequest?.abort();
      catalogueRequest = null;
      loading = false;
      stop();
      tracks = [];
      selected = null;
      seeking = false;
      visible = false;
      audio.loop = true;
      $('audioTracks').replaceChildren();
      renderLoop();
      render();
      status('');
    },
  };
  render();
})();
