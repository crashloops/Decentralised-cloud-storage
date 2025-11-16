/**
 * Web Crypto AES-GCM helpers for frontend
 */

/**
 * Generate AES-GCM 256-bit key
 * Keys are generated as non-extractable by default for security.
 * Only export when explicitly needed (e.g., for owner encryption).
 */
export async function generateAESKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false, // non-extractable by default (more secure)
    ["encrypt", "decrypt"]
  );
}

/**
 * Generate extractable AES key (use only when export is required)
 * This should only be used when you need to export the key (e.g., for owner encryption).
 * The exported key must be handled securely and never persisted.
 */
export async function generateExtractableAESKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true, // extractable (only when export is needed)
    ["encrypt", "decrypt"]
  );
}

/**
 * Export CryptoKey to base64 string
 * WARNING: Only call this when the key is extractable and you need to export it.
 * The exported key must be handled securely and never persisted to storage.
 * This is typically used only for owner encryption before on-chain storage.
 */
export async function exportKeyToBase64(key: CryptoKey): Promise<string> {
  try {
    const raw = await crypto.subtle.exportKey("raw", key);
    return arrayBufferToBase64(raw);
  } catch (err) {
    if (err instanceof DOMException && err.name === "InvalidAccessError") {
      throw new Error("Key is not extractable. Use generateExtractableAESKey() if export is needed.");
    }
    throw err;
  }
}

/**
 * Import base64 string to CryptoKey
 * Imported keys are non-extractable for security.
 */
export async function importKeyFromBase64(base64: string): Promise<CryptoKey> {
  if (!base64 || typeof base64 !== "string") {
    throw new Error("Invalid base64 input: must be a non-empty string");
  }
  const raw = base64ToArrayBuffer(base64);
  return crypto.subtle.importKey(
    "raw",
    raw,
    { name: "AES-GCM" },
    false, // non-extractable (more secure)
    ["encrypt", "decrypt"]
  );
}

/**
 * Encrypt chunk with AES-GCM using AAD (Additional Authenticated Data) = chunkIndex
 */
export async function encryptChunk(
  key: CryptoKey,
  data: ArrayBuffer,
  chunkIndex: number
): Promise<{ packed: Blob; iv: Uint8Array }> {
  const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV
  const aad = new TextEncoder().encode(chunkIndex.toString());
  
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad },
    key,
    data
  );

  // Pack: [iv(12 bytes)] + [ciphertext]
  const packed = new Uint8Array(12 + ciphertext.byteLength);
  packed.set(iv, 0);
  packed.set(new Uint8Array(ciphertext), 12);

  return { packed: new Blob([packed.buffer]), iv };
}

/**
 * Decrypt chunk with AES-GCM
 */
export async function decryptChunk(
  key: CryptoKey,
  packedData: ArrayBuffer,
  chunkIndex: number
): Promise<ArrayBuffer> {
  const packed = new Uint8Array(packedData);
  if (packed.length < 13) {
    throw new Error("Packed data too small");
  }

  const iv = packed.slice(0, 12);
  const ciphertext = packed.slice(12).buffer;
  const aad = new TextEncoder().encode(chunkIndex.toString());

  return crypto.subtle.decrypt(
    { name: "AES-GCM", iv, additionalData: aad },
    key,
    ciphertext
  );
}

/**
 * Helper: ArrayBuffer to base64
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  if (!buffer || buffer.byteLength === 0) {
    throw new Error("Invalid ArrayBuffer: must be non-empty");
  }
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunkSize))
    );
  }
  try {
    return btoa(binary);
  } catch (err) {
    throw new Error("Failed to encode ArrayBuffer to base64");
  }
}

/**
 * Helper: Base64 to ArrayBuffer
 */
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  if (!base64 || typeof base64 !== "string") {
    throw new Error("Invalid base64 input: must be a non-empty string");
  }
  try {
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  } catch (err) {
    throw new Error("Invalid base64 string: failed to decode");
  }
}

