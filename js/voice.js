// Reconhecimento de voz (Web Speech API) em português do Brasil.
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

export const voiceSupported = () => !!Recognition;

let current = null;

/**
 * Inicia a escuta. Chama onText(texto, final) conforme a fala é reconhecida.
 * Retorna uma função para parar.
 */
export function listen({ onText, onEnd, onError }) {
  if (!Recognition) {
    onError?.('unsupported');
    return () => {};
  }
  stop();
  const rec = new Recognition();
  rec.lang = 'pt-BR';
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;

  let finalText = '';
  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    onText?.((finalText + ' ' + interim).trim(), !interim);
  };
  rec.onerror = (e) => onError?.(e.error);
  rec.onend = () => {
    current = null;
    onEnd?.(finalText.trim());
  };
  current = rec;
  try { rec.start(); } catch { onError?.('start'); }
  return stop;
}

export function stop() {
  if (current) {
    try { current.stop(); } catch { /* já parado */ }
    current = null;
  }
}
