// Reconhecimento de voz (Web Speech API) em português do Brasil.
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

export const voiceSupported = () => !!Recognition;

export const isIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// App aberto pelo ícone da tela inicial (modo instalado).
export const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;

let current = null;

/**
 * Inicia a escuta. DEVE ser chamada diretamente dentro do toque do usuário
 * (sem setTimeout/await antes), senão o navegador bloqueia o microfone.
 * onText(texto) recebe o texto parcial/final conforme a fala é reconhecida.
 * onEnd(texto) é chamado ao terminar; onError(codigo) em caso de falha.
 */
export function listen({ onStart, onText, onEnd, onError }) {
  if (!Recognition) {
    onError?.('unsupported');
    return;
  }
  stop();
  const rec = new Recognition();
  rec.lang = 'pt-BR';
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;

  let text = '';
  let failed = false;
  rec.onstart = () => onStart?.();
  rec.onresult = (e) => {
    let finalText = '', interim = '';
    for (let i = 0; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    text = `${finalText} ${interim}`.replace(/\s+/g, ' ').trim();
    onText?.(text);
  };
  rec.onerror = (e) => {
    // 'aborted' acontece quando o próprio usuário para a escuta: não é erro.
    if (e.error === 'aborted') return;
    failed = true;
    onError?.(e.error || 'unknown');
  };
  rec.onend = () => {
    if (current === rec) current = null;
    onEnd?.(text, failed);
  };
  current = rec;
  try {
    rec.start();
  } catch {
    current = null;
    onError?.('start');
  }
}

export function stop() {
  if (current) {
    try { current.stop(); } catch { /* já parado */ }
  }
}
