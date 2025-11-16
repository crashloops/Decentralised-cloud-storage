/**
 * Secure file encryption helpers
 * 
 * SECURITY: Keys are non-extractable by default.
 * Only export when explicitly needed for owner encryption.
 */

/**
 * Robust ArrayBuffer to Base64 conversion (handles large buffers)
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  if (!buffer || buffer.byteLength === 0) {
    throw new Error("Invalid ArrayBuffer: must be non-empty");
  }
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000; // 32KB chunks to avoid stack overflow
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
 * Robust Base64 to ArrayBuffer conversion
 */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
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

/**
 * Encrypt file with AES-GCM
 * 
 * @param file - File to encrypt
 * @param ownerPublicKey - Optional MetaMask-style public key (x25519) to encrypt AES key for owner
 * @returns Encrypted blob and optionally encryptedKeyForOwner (if ownerPublicKey provided)
 * 
 * SECURITY: If ownerPublicKey is provided, the AES key is exported once and encrypted.
 * If not provided, the key remains non-extractable in memory (non-resumable).
 */
export async function encryptFile(file: File, ownerPublicKey?: string) {
  // Generate non-extractable AES key by default
  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false, // non-extractable (more secure)
    ['encrypt', 'decrypt']
  );
  
  const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV
  const buf = await file.arrayBuffer();
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    buf
  );

  if (ownerPublicKey) {
    // Export key one time only to encrypt for owner
    // This requires the key to be extractable, so we need to generate a new extractable key
    const extractableKey = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true, // extractable (only for owner encryption)
      ['encrypt', 'decrypt']
    );
    
    // Re-encrypt with extractable key (for owner encryption)
    const ctWithExtractable = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      extractableKey,
      buf
    );
    
    // Export and encrypt for owner
    const rawKey = await crypto.subtle.exportKey('raw', extractableKey);
    const rawB64 = arrayBufferToBase64(rawKey);
    
    // Use pure browser encryption (no Node.js dependencies)
    const { encryptForMetaMask } = await import('./utils/encryption');
    const encryptedObj = encryptForMetaMask(ownerPublicKey, rawB64);
    
    return {
      encryptedBlob: new Blob([ctWithExtractable], { type: file.type || 'application/octet-stream' }),
      encryptedKeyForOwner: JSON.stringify(encryptedObj),
      ivB64: arrayBufferToBase64(iv.buffer),
    };
  } else {
    // Do NOT export or return rawKey — keep key only in-memory for current session
    return {
      encryptedBlob: new Blob([ct], { type: file.type || 'application/octet-stream' }),
      ivB64: arrayBufferToBase64(iv.buffer),
      // Caller must keep key reference in memory if they wish to download later
    };
  }
}

/**
 * Decrypt blob to file
 * 
 * @param cipherBlob - Encrypted blob
 * @param rawKeyArrayBuffer - Raw AES key (must be in-memory, never from storage)
 * @param ivB64 - Base64-encoded IV
 * @param mime - MIME type for output blob
 * 
 * SECURITY: rawKeyArrayBuffer must only be provided for in-memory operations.
 * Do NOT read it from IndexedDB. It should come from eth_decrypt.
 */
export async function decryptToBlob(
  cipherBlob: Blob,
  rawKeyArrayBuffer: ArrayBuffer,
  ivB64: string,
  mime: string
) {
  if (!rawKeyArrayBuffer || rawKeyArrayBuffer.byteLength === 0) {
    throw new Error("Invalid raw key: must be non-empty ArrayBuffer");
  }
  if (!ivB64 || typeof ivB64 !== "string") {
    throw new Error("Invalid IV: must be base64 string");
  }
  
  const key = await crypto.subtle.importKey(
    'raw',
    rawKeyArrayBuffer,
    { name: 'AES-GCM' },
    false, // non-extractable
    ['decrypt']
  );
  const ct = await cipherBlob.arrayBuffer();
  const iv = new Uint8Array(base64ToArrayBuffer(ivB64));
  
  if (iv.length !== 12) {
    throw new Error("Invalid IV: must be 12 bytes");
  }
  
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ct
  );
  return new Blob([pt], { type: mime || 'application/octet-stream' });
}

/**
 * @deprecated Use arrayBufferToBase64 instead
 */
export function bufToB64(buf: ArrayBuffer) {
  return arrayBufferToBase64(buf);
}

/**
 * @deprecated Use base64ToArrayBuffer instead
 */
export function b64ToBuf(b64: string) {
  return base64ToArrayBuffer(b64);
}
