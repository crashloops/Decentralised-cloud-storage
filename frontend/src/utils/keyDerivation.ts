/**
 * Deterministic X25519 key derivation from Ethereum signatures
 * Replaces deprecated MetaMask encryption APIs with signature-based keys
 * 
 * Flow:
 * 1. User signs a message
 * 2. Derive X25519 keypair from signature (deterministic)
 * 3. Use for encryption/decryption (pure browser crypto)
 * 
 * This is how modern E2EE systems work (Lit Protocol, Filecoin FVM, etc.)
 */

import nacl from 'tweetnacl'
import { encodeBase64, decodeBase64 } from 'tweetnacl-util'

/**
 * Standard message for key derivation
 * User must sign this message to authorize encryption/decryption
 */
export const KEY_DERIVATION_MESSAGE = "Authorize this app to encrypt files for you\n\nThis signature is used to derive your encryption key. It does not grant any permissions or approve transactions."

/**
 * Derive X25519 keypair from Ethereum signature
 * Same signature → same keypair (deterministic)
 * Uses SHA-256 hash of signature for secure key derivation
 * 
 * @param signature - Ethereum signature (0x-prefixed hex string)
 * @returns X25519 keypair { publicKey: Uint8Array, secretKey: Uint8Array }
 */
export async function deriveKeyPairFromSignature(signature: string): Promise<nacl.BoxKeyPair> {
  if (!signature || typeof signature !== 'string' || !signature.startsWith('0x')) {
    throw new Error('Invalid signature format: must be 0x-prefixed hex string');
  }

  // Remove 0x prefix and convert hex to bytes
  const hex = signature.slice(2);
  if (hex.length < 64) {
    throw new Error('Invalid signature: too short');
  }

  // Convert hex signature to bytes
  const signatureBytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < signatureBytes.length; i++) {
    signatureBytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }

  // Hash signature using SHA-256 for secure key derivation
  // This ensures deterministic key generation while maintaining security
  const hashBuffer = await crypto.subtle.digest('SHA-256', signatureBytes);
  const seedBytes = new Uint8Array(hashBuffer).slice(0, 32); // Use first 32 bytes of hash

  // Derive X25519 keypair from seed
  // tweetnacl uses the seed directly for key generation
  const keyPair = nacl.box.keyPair.fromSecretKey(seedBytes);

  return keyPair;
}

/**
 * Request user signature and derive encryption keypair
 * 
 * @param signer - Ethers signer (from wallet)
 * @param account - Account address
 * @returns X25519 public key (base64) and keypair
 */
export async function requestEncryptionKeypair(
  signer: any,
  account: string
): Promise<{ publicKeyBase64: string; keyPair: nacl.BoxKeyPair }> {
  if (!signer || typeof signer.signMessage !== 'function') {
    throw new Error('Signer not available. Please connect your wallet.');
  }

  if (!account || typeof account !== 'string' || !account.startsWith('0x')) {
    throw new Error('Invalid account address');
  }

  console.log('[KeyDerivation] Requesting signature for key derivation...');

  try {
    // Request signature from user
    const signature = await signer.signMessage(KEY_DERIVATION_MESSAGE);
    
    if (!signature || typeof signature !== 'string') {
      throw new Error('Invalid signature received from wallet');
    }

    console.log('[KeyDerivation] Signature received, deriving keypair...');

    // Derive keypair from signature (async - uses SHA-256 hash)
    const keyPair = await deriveKeyPairFromSignature(signature);

    // Encode public key to base64 for storage
    const publicKeyBase64 = encodeBase64(keyPair.publicKey);

    console.log('[KeyDerivation] Keypair derived successfully', {
      publicKeyLength: keyPair.publicKey.length,
      publicKeyBase64: publicKeyBase64.substring(0, 20) + '...',
    });

    return {
      publicKeyBase64,
      keyPair,
    };
  } catch (err: any) {
    const errorMsg = err?.message || String(err);
    
    if (errorMsg.includes('reject') || errorMsg.includes('denied') || err?.code === 4001) {
      throw new Error(
        'Signature request was rejected. ' +
        'Please approve the signature request in MetaMask to enable file encryption/decryption.'
      );
    }

    throw new Error(`Failed to derive encryption key: ${errorMsg}`);
  }
}

/**
 * Derive decryption keypair from signature
 * Used when decrypting files
 * 
 * @param signer - Ethers signer (from wallet)
 * @param account - Account address
 * @returns X25519 keypair for decryption
 */
export async function deriveDecryptionKeypair(
  signer: any,
  account: string
): Promise<nacl.BoxKeyPair> {
  if (!signer || typeof signer.signMessage !== 'function') {
    throw new Error('Signer not available. Please connect your wallet.');
  }

  if (!account || typeof account !== 'string' || !account.startsWith('0x')) {
    throw new Error('Invalid account address');
  }

  console.log('[KeyDerivation] Requesting signature for decryption...');

  try {
    // Request signature from user (same message = same key)
    const signature = await signer.signMessage(KEY_DERIVATION_MESSAGE);
    
    if (!signature || typeof signature !== 'string') {
      throw new Error('Invalid signature received from wallet');
    }

    console.log('[KeyDerivation] Signature received, deriving decryption keypair...');

    // Derive keypair from signature (deterministic - same as encryption, uses SHA-256 hash)
    const keyPair = await deriveKeyPairFromSignature(signature);

    console.log('[KeyDerivation] Decryption keypair derived successfully');

    return keyPair;
  } catch (err: any) {
    const errorMsg = err?.message || String(err);
    
    if (errorMsg.includes('reject') || errorMsg.includes('denied') || err?.code === 4001) {
      throw new Error(
        'Signature request was rejected. ' +
        'Please approve the signature request in MetaMask to decrypt the file.'
      );
    }

    throw new Error(`Failed to derive decryption key: ${errorMsg}`);
  }
}

