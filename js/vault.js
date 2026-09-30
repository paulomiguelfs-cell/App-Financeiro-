// Cofre local: os dados ficam criptografados (AES-GCM) no aparelho.
// A chave é derivada da senha com PBKDF2 e só existe na memória enquanto o app está desbloqueado.

const KEY = 'fin.vault.v1';
const ITERATIONS = 250000;
const enc = new TextEncoder();
const dec = new TextDecoder();

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(password, salt, iterations = ITERATIONS) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

let session = null; // { key, salt, iterations }

export const hasVault = () => {
  try { return !!localStorage.getItem(KEY); } catch { return false; }
};

export const isUnlocked = () => !!session;

async function write(data) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, session.key, enc.encode(JSON.stringify(data)));
  localStorage.setItem(KEY, JSON.stringify({
    v: 1, salt: b64(session.salt), iter: session.iterations, iv: b64(iv), data: b64(cipher),
  }));
}

export async function createVault(password, data) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  session = { key: await deriveKey(password, salt), salt, iterations: ITERATIONS };
  await write(data);
}

// Retorna os dados descriptografados ou lança erro se a senha estiver errada.
export async function unlock(password) {
  const raw = JSON.parse(localStorage.getItem(KEY));
  const salt = unb64(raw.salt);
  const key = await deriveKey(password, salt, raw.iter);
  let plain;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(raw.iv) }, key, unb64(raw.data));
  } catch {
    throw new Error('Senha incorreta');
  }
  session = { key, salt, iterations: raw.iter };
  return JSON.parse(dec.decode(plain));
}

export async function save(data) {
  if (!session) return;
  await write(data);
}

export async function changePassword(current, next, data) {
  await unlock(current); // valida a senha atual
  await createVault(next, data);
}

export function lock() {
  session = null;
}

export function destroy() {
  session = null;
  localStorage.removeItem(KEY);
}
