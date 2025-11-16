/**
 * Pure browser encryption/decryption utility
 * Uses tweetnacl (x25519-xsalsa20-poly1305) - same scheme as MetaMask
 * No MetaMask encryption APIs - 100% reliable, no deprecation issues
 * No Node.js dependencies required
 */

import nacl from 'tweetnacl'
import { decodeUTF8, encodeBase64, decodeBase64 } from 'tweetnacl-util'

/**
 * Encrypt data using X25519 public key
 * Produces format compatible with our decryption function
 * 
 * @param recipientPublicKeyBase64 - Recipient's X25519 public key (base64)
 * @param data - Data to encrypt (string)
 * @returns Encrypted object
 */
export function encryptForRecipient(
  recipientPublicKeyBase64: string,
  data: string
): {
  version: string;
  ephemPublicKey: string;
  nonce: string;
  ciphertext: string;
} {
  // Validate inputs
  if (!recipientPublicKeyBase64 || typeof recipientPublicKeyBase64 !== 'string') {
    throw new Error(`Invalid publicKey: expected string, got ${typeof recipientPublicKeyBase64}`);
  }
  if (!data || typeof data !== 'string') {
    throw new Error(`Invalid data: expected string, got ${typeof data}`);
  }

  let recipientPublicKey: Uint8Array;
  try {
    // Decode base64 public key to get raw 32-byte x25519 public key
    recipientPublicKey = decodeBase64(recipientPublicKeyBase64);
    
    // x25519 public keys are 32 bytes
    if (recipientPublicKey.length !== 32) {
      throw new Error(`Invalid public key length: expected 32 bytes, got ${recipientPublicKey.length}`);
    }
  } catch (err: any) {
    throw new Error(`Failed to parse public key: ${err?.message || String(err)}`);
  }

  // Generate ephemeral key pair (sender)
  const ephemeralKeyPair = nacl.box.keyPair();
  const ephemeralPublicKey = ephemeralKeyPair.publicKey;
  const ephemeralSecretKey = ephemeralKeyPair.secretKey;

  // Convert data to bytes
  const dataBytes = decodeUTF8(data);

  // Generate nonce (24 bytes for xsalsa20-poly1305)
  const nonce = nacl.randomBytes(24);

  // Encrypt using nacl.box (x25519-xsalsa20-poly1305)
  const ciphertext = nacl.box(dataBytes, nonce, recipientPublicKey, ephemeralSecretKey);

  if (!ciphertext) {
    throw new Error('Encryption failed: nacl.box returned null');
  }

  // Format encrypted object
  return {
    version: 'x25519-xsalsa20-poly1305',
    ephemPublicKey: encodeBase64(ephemeralPublicKey),
    nonce: encodeBase64(nonce),
    ciphertext: encodeBase64(ciphertext),
  };
}

/**
 * Decrypt data using X25519 secret key
 * 
 * @param encryptedObj - Encrypted object with version, ephemPublicKey, nonce, ciphertext
 * @param recipientSecretKey - Recipient's X25519 secret key (Uint8Array)
 * @returns Decrypted plaintext (string)
 */
export function decryptForRecipient(
  encryptedObj: {
    version: string;
    ephemPublicKey: string;
    nonce: string;
    ciphertext: string;
  },
  recipientSecretKey: Uint8Array
): string {
  // Validate inputs
  if (!encryptedObj || typeof encryptedObj !== 'object') {
    throw new Error('Invalid encrypted object');
  }

  if (encryptedObj.version !== 'x25519-xsalsa20-poly1305') {
    throw new Error(`Invalid version: expected 'x25519-xsalsa20-poly1305', got '${encryptedObj.version}'`);
  }

  if (!encryptedObj.ephemPublicKey || !encryptedObj.nonce || !encryptedObj.ciphertext) {
    throw new Error('Missing required fields in encrypted object');
  }

  if (!recipientSecretKey || recipientSecretKey.length !== 32) {
    throw new Error('Invalid secret key: must be 32 bytes');
  }

  try {
    // Decode base64 fields
    const ephemPublicKey = decodeBase64(encryptedObj.ephemPublicKey);
    const nonce = decodeBase64(encryptedObj.nonce);
    const ciphertext = decodeBase64(encryptedObj.ciphertext);

    // Decrypt using nacl.box.open
    const plaintext = nacl.box.open(ciphertext, nonce, ephemPublicKey, recipientSecretKey);

    if (!plaintext) {
      throw new Error('Decryption failed: nacl.box.open returned null');
    }

    // Convert bytes back to string
    return new TextDecoder().decode(plaintext);
  } catch (err: any) {
    throw new Error(`Decryption failed: ${err?.message || String(err)}`);
  }
}

/**
 * Legacy function name for backward compatibility
 * @deprecated Use encryptForRecipient instead
 */
export function encryptForMetaMask(publicKeyBase64: string, data: string) {
  return encryptForRecipient(publicKeyBase64, data);
}
