// src/services/cryptoService.js
// Plain JS: Web Crypto AES-GCM helpers (production-ready)

/**
 * generateAESKey - AES-GCM 256
 * @returns {Promise<CryptoKey>}
 */
export async function generateAESKey() {
  return crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true, // extractable so we can export to encrypt with MetaMask
    ["encrypt", "decrypt"]
  );
}

/**
 * exportKeyToBase64 - exports CryptoKey raw -> base64
 * @param {CryptoKey} key
 * @returns {Promise<string>}
 */
export async function exportKeyToBase64(key) {
  const raw = await crypto.subtle.exportKey("raw", key);
  return arrayBufferToBase64(raw);
}

/**
 * importKeyFromBase64 - import base64 raw -> CryptoKey
 * @param {string} base64
 * @returns {Promise<CryptoKey>}
 */
export async function importKeyFromBase64(base64) {
  const raw = base64ToArrayBuffer(base64);
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, true, ["decrypt"]);
}

/**
 * encryptFileWithAES - returns {ciphertext:ArrayBuffer, iv:Uint8Array, mimeType}
 * @param {CryptoKey} key
 * @param {File|Blob} file
 */
export async function encryptFileWithAES(key, file) {
  const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV (recommended for AES-GCM)
  const data = await file.arrayBuffer();
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    data
  );
  return { ciphertext, iv, mimeType: file.type || "application/octet-stream" };
}

/**
 * packEncryptedBlob - produce a Blob: [iv(12 bytes)] + ciphertext
 * @param {ArrayBuffer} ciphertext
 * @param {Uint8Array} iv
 * @param {string} mimeType
 * @returns {Blob}
 */
export function packEncryptedBlob(ciphertext, iv, mimeType = "application/octet-stream") {
  // Ensure iv is Uint8Array(12)
  if (!(iv instanceof Uint8Array) || iv.byteLength !== 12) {
    throw new Error("IV must be a Uint8Array of length 12 bytes");
  }
  const ivBuf = iv.buffer;
  const combined = new Uint8Array(ivBuf.byteLength + ciphertext.byteLength);
  combined.set(new Uint8Array(ivBuf), 0);
  combined.set(new Uint8Array(ciphertext), ivBuf.byteLength);
  return new Blob([combined.buffer], { type: mimeType });
}

/**
 * unpackIvAndCiphertext - split an ArrayBuffer produced by packEncryptedBlob into { iv:Uint8Array, ciphertext:ArrayBuffer }
 * @param {ArrayBuffer} fullArrayBuffer
 * @returns {{iv:Uint8Array, ciphertext:ArrayBuffer}}
 */
export function unpackIvAndCiphertext(fullArrayBuffer) {
  const full = new Uint8Array(fullArrayBuffer);
  if (full.length < 13) throw new Error("Data too small to contain IV + ciphertext");
  const iv = full.slice(0, 12); // Uint8Array
  const ciphertext = full.slice(12).buffer; // ArrayBuffer
  return { iv, ciphertext };
}

/**
 * decryptArrayBuffer - decrypt AES-GCM ciphertext (ArrayBuffer) given CryptoKey and iv
 * @param {CryptoKey} cryptoKey - AES CryptoKey (for decrypt)
 * @param {Uint8Array} iv - 12 byte IV
 * @param {ArrayBuffer} ciphertext - ciphertext ArrayBuffer (includes auth tag appended by WebCrypto)
 * @returns {Promise<ArrayBuffer>} plaintext ArrayBuffer
 */
export async function decryptArrayBuffer(cryptoKey, iv, ciphertext) {
  if (!(iv instanceof Uint8Array) || iv.byteLength !== 12) {
    throw new Error("IV must be a Uint8Array of length 12");
  }
  // Web Crypto will verify auth tag automatically; this will throw on authentication failure.
  return crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    ciphertext
  );
}

/* -----------------------
   Helper conversions
   ----------------------- */
export function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000; // avoid stack overflows on large buffers
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
