/**
 * Pure browser decryption utility - NO MetaMask decrypt API
 * Uses signature-based key derivation + pure browser crypto
 * 100% reliable, no deprecation issues
 */

import { deriveDecryptionKeypair } from './keyDerivation'
import { decryptForRecipient } from './encryption'
import { normalizeCiphertextInput } from './decryptionHelpers'

/**
 * Decrypt ciphertext using signature-derived keypair
 * NO MetaMask decrypt API - pure browser crypto
 * 
 * @param rawCiphertextValue - Encrypted value from contract (may be string, hex, bytes, etc.)
 * @param signer - Ethers signer (for signature)
 * @param account - Ethereum account address
 * @returns Decrypted plaintext (base64 AES key)
 * @throws Error with clear message on any failure
 */
export async function requestDecryptionFromMetaMask(
  rawCiphertextValue: any,
  signer: any,
  account: string
): Promise<string> {
  // Validate inputs
  if (!signer || typeof signer.signMessage !== 'function') {
    throw new Error('Signer not available. Please connect your wallet.');
  }

  if (!account || typeof account !== 'string' || !account.startsWith('0x')) {
    throw new Error('Invalid account address');
  }

  console.log('[Decrypt] Starting pure browser decryption (no MetaMask decrypt API)...');

  // Normalize ciphertext input (handles hex, bytes, double-stringified JSON, etc.)
  const normalized = normalizeCiphertextInput(rawCiphertextValue);

  if (!normalized || typeof normalized !== 'string') {
    console.error('[Decrypt] Normalized ciphertext invalid:', normalized, 'raw:', rawCiphertextValue);
    throw new Error('Ciphertext retrieved from contract is not valid. See console for details.');
  }

  // Parse encrypted object
  let encryptedObj: any;
  try {
    encryptedObj = JSON.parse(normalized);
  } catch (e) {
    console.error('[Decrypt] Failed to parse normalized ciphertext JSON:', normalized);
    throw new Error('Ciphertext is not valid JSON. The stored on-chain value may be corrupted.');
  }

  // Validate structure
  const { version, ephemPublicKey, nonce, ciphertext } = encryptedObj ?? {};

  if (!version || !ephemPublicKey || !nonce || !ciphertext) {
    console.error('[Decrypt] Ciphertext missing required fields:', encryptedObj);
    throw new Error('Ciphertext JSON missing required fields (version, ephemPublicKey, nonce, ciphertext).');
  }

  if (version !== 'x25519-xsalsa20-poly1305') {
    throw new Error(`Invalid ciphertext version: expected 'x25519-xsalsa20-poly1305', got '${version}'`);
  }

  console.log('[Decrypt] Ciphertext structure validated:', {
    version,
    ephemPublicKeyLength: ephemPublicKey.length,
    nonceLength: nonce.length,
    ciphertextLength: ciphertext.length,
  });

  // Derive decryption keypair from user signature
  console.log('[Decrypt] Requesting signature to derive decryption key...');
  const keyPair = await deriveDecryptionKeypair(signer, account);

  // Decrypt using pure browser crypto
  console.log('[Decrypt] Decrypting with derived keypair...');
  const plaintext = decryptForRecipient(encryptedObj, keyPair.secretKey);

  if (!plaintext || plaintext.length === 0) {
    throw new Error('Decryption returned empty result');
  }

  console.log('[Decrypt] Successfully decrypted key', {
    keyLength: plaintext.length,
  });

  return plaintext;
}
