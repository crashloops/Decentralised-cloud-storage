/**
 * Chunked file upload service
 * Handles chunked encryption, upload to proxy, metadata creation, and on-chain registration
 */

import { generateAESKey, exportKeyToBase64, importKeyFromBase64, encryptChunk } from "./cryptoService";
import { get, set, del } from "idb-keyval";
import { Contract, BigNumber } from "ethers";
import CONTRACT_ABI from "../contracts/TimeBoundFileRegistry.abi.json";
import { encryptForRecipient } from "../utils/encryption";
import { requestEncryptionKeypair } from "../utils/keyDerivation";

const PROXY_URL = import.meta.env.VITE_PROXY_URL || "";
const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS || "";
const UPLOAD_SECRET = import.meta.env.VITE_UPLOAD_SECRET || ""; // Optional: only needed if backend requires HMAC

// Default chunk size: 2MB
function defaultChunkSize(): number {
  return 2 * 1024 * 1024;
}

/**
 * Generate HMAC signature for upload authentication
 * Only used if UPLOAD_SECRET is configured
 */
async function generateHmacHeaders(): Promise<Record<string, string>> {
  if (!UPLOAD_SECRET) {
    // In development, backend allows requests without HMAC if secret not set
    return {};
  }

  const timestamp = Date.now().toString();
  const nonce = crypto.getRandomValues(new Uint8Array(16))
    .reduce((str, byte) => str + byte.toString(16).padStart(2, '0'), '');
  
  const payload = `${timestamp}.${nonce}`;
  
  // Use Web Crypto API for HMAC
  const encoder = new TextEncoder();
  const keyData = encoder.encode(UPLOAD_SECRET);
  const payloadData = encoder.encode(payload);
  
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, payloadData);
  const signatureHex = Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  
  return {
    'x-upload-ts': timestamp,
    'x-upload-nonce': nonce,
    'x-upload-signature': signatureHex,
  };
}

// Generate unique upload session ID
function generateUploadId(ownerAddr: string): string {
  return `upload_${ownerAddr}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

/**
 * Upload chunk to proxy
 */
async function uploadChunkWithRetries(
  blob: Blob,
  opts: { proxyUrl: string; maxRetries?: number }
): Promise<string> {
  const { proxyUrl, maxRetries = 3 } = opts;
  if (!proxyUrl) {
    throw new Error("Proxy URL required");
  }

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const formData = new FormData();
      formData.append("file", blob, "chunk.bin");

      // Generate HMAC headers if secret is configured
      const hmacHeaders = await generateHmacHeaders();

      // Note: Don't set Content-Type header - browser will set it automatically with boundary for FormData
      const response = await fetch(`${proxyUrl}/upload`, {
        method: "POST",
        body: formData,
        headers: hmacHeaders, // Custom headers (x-upload-*) are preserved
      });

      if (!response.ok) {
        // Try to parse error response for detailed error message
        let errorMessage = `Upload failed: ${response.statusText}`;
        try {
          const contentType = response.headers.get("content-type");
          if (contentType && contentType.includes("application/json")) {
            const errorBody = await response.json();
            if (errorBody.error) {
              errorMessage = errorBody.error;
              if (errorBody.detail) {
                errorMessage += ` - ${errorBody.detail}`;
              }
            }
          } else {
            const errorText = await response.text();
            if (errorText) {
              errorMessage = `Upload failed: ${errorText}`;
            }
          }
        } catch (parseErr) {
          // If parsing fails, use status text (response body already consumed)
          console.warn("Failed to parse error response:", parseErr);
        }
        throw new Error(errorMessage);
      }

      const result = await response.json();
      if (!result.cid) {
        throw new Error("Server response missing CID");
      }
      return result.cid;
    } catch (err) {
      lastError = err as Error;
      // Don't retry on certain errors (e.g., authentication, bad request)
      if (err instanceof Error) {
        if (err.message.includes("Unauthorized") || 
            err.message.includes("401") ||
            err.message.includes("400") ||
            err.message.includes("File too large")) {
          throw err; // Don't retry auth/size errors
        }
      }
      if (attempt < maxRetries - 1) {
        const delay = 1000 * Math.pow(2, attempt);
        console.log(`Upload attempt ${attempt + 1} failed, retrying in ${delay}ms...`, err);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError || new Error("Upload failed after retries");
}

/**
 * Upload metadata JSON to proxy
 */
async function uploadMetadata(
  metadata: any,
  proxyUrl: string
): Promise<string> {
  const blob = new Blob([JSON.stringify(metadata)], {
    type: "application/json",
  });
  const formData = new FormData();
  formData.append("file", blob, "metadata.json");

  // Generate HMAC headers if secret is configured
  const hmacHeaders = await generateHmacHeaders();

  // Note: Don't set Content-Type header - browser will set it automatically with boundary for FormData
  const response = await fetch(`${proxyUrl}/metadata`, {
    method: "POST",
    body: formData,
    headers: hmacHeaders, // Custom headers (x-upload-*) are preserved
  });

  if (!response.ok) {
    // Try to parse error response for detailed error message
    let errorMessage = `Metadata upload failed: ${response.statusText}`;
    try {
      const contentType = response.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        const errorBody = await response.json();
        if (errorBody.error) {
          errorMessage = errorBody.error;
          if (errorBody.detail) {
            errorMessage += ` - ${errorBody.detail}`;
          }
        }
      } else {
        const errorText = await response.text();
        if (errorText) {
          errorMessage = `Metadata upload failed: ${errorText}`;
        }
      }
    } catch (parseErr) {
      // If parsing fails, use status text (response body already consumed)
      console.warn("Failed to parse error response:", parseErr);
    }
    throw new Error(errorMessage);
  }

  const result = await response.json();
  if (!result.cid) {
    throw new Error("Server response missing CID for metadata");
  }
  return result.cid;
}

interface UploadOptions {
  ownerAddr: string;
  signer?: any;
  contractAddress?: string;
  chunkSize?: number;
  concurrency?: number;
  proxyUrl?: string;
  onProgress?: (percent: number, uploadedBytes: number, totalBytes: number) => void;
  autoRegister?: boolean;
  maxRetries?: number;
}

interface UploadState {
  uploadId: string;
  filename: string;
  mimeType: string;
  fileSize: number;
  chunkSize: number;
  totalChunks: number;
  uploaded: Record<number, { cid: string; size: number }>;
  encryptedAesForOwner: string | null;
  metadataCid: string | null;
  registeredAt?: number;
  onChainTx?: string;
}

/**
 * Main chunked upload function
 */
export async function chunkedUploadFile(
  file: File,
  opts: UploadOptions
): Promise<{ metadataCid: string; metadata: any; sessionKey: string; txReceipt?: any }> {
  const {
    ownerAddr: providedOwnerAddr,
    signer = null,
    contractAddress = CONTRACT_ADDRESS,
    chunkSize = defaultChunkSize(),
    concurrency = 2,
    proxyUrl = PROXY_URL,
    onProgress = null,
    autoRegister = false,
    maxRetries = 3,
  } = opts;

  if (!proxyUrl) {
    throw new Error("VITE_PROXY_URL must be set");
  }

  // CRITICAL: Resolve owner address from signer if not provided or if autoRegister is enabled
  // This ensures we always have a valid address for encryption and on-chain registration
  let ownerAddr: string;
  if (providedOwnerAddr) {
    ownerAddr = providedOwnerAddr;
  } else if (signer) {
    try {
      ownerAddr = await signer.getAddress();
      console.log('[Upload] Resolved owner address from signer:', ownerAddr);
    } catch (err: any) {
      throw new Error(`Failed to get address from signer: ${err?.message || String(err)}. Please ensure your wallet is connected.`);
    }
  } else {
    throw new Error("ownerAddr is required. Either provide it in opts or ensure signer is available.");
  }

  // Validate owner address format
  if (!ownerAddr || typeof ownerAddr !== 'string' || !ownerAddr.startsWith('0x')) {
    throw new Error(`Invalid owner address: ${ownerAddr}. Expected a valid Ethereum address starting with 0x.`);
  }

  if (autoRegister && (!signer || !contractAddress)) {
    throw new Error("autoRegister requires signer and contractAddress");
  }

  const sessionKey = generateUploadId(ownerAddr);
  const totalSize = file.size;
  const totalChunks = Math.ceil(totalSize / chunkSize);

  // Load or create session state
  let state: UploadState = (await get(sessionKey)) || {
    uploadId: sessionKey,
    filename: file.name,
    mimeType: file.type || "application/octet-stream",
    fileSize: totalSize,
    chunkSize,
    totalChunks,
    uploaded: {},
    encryptedAesForOwner: null,
    metadataCid: null,
  };

  // Prepare AES key
  let aesCryptoKey: CryptoKey | null = null;
  let aesKeyBase64: string | null = null;

  // Check if resuming (encrypted key exists)
  if (state.encryptedAesForOwner) {
    if (!window.ethereum) {
      throw new Error("MetaMask required to decrypt AES key for resume");
    }
    try {
      const decryptedBase64 = await window.ethereum.request({
        method: "eth_decrypt",
        params: [state.encryptedAesForOwner, ownerAddr],
      });
      aesKeyBase64 = decryptedBase64 as string;
      aesCryptoKey = await importKeyFromBase64(aesKeyBase64);
    } catch (err) {
      throw new Error(`Failed to decrypt AES key: ${(err as Error).message}`);
    }
  } else {
    // Fresh session: generate extractable key (needed for owner encryption)
    // We need extractable key to export and encrypt with owner's public key
    const { generateExtractableAESKey } = await import("./cryptoService");
    const genKey = await generateExtractableAESKey();
    aesCryptoKey = genKey;
    
    // Export key to base64 - validate it succeeds
    try {
      aesKeyBase64 = await exportKeyToBase64(genKey);
      if (!aesKeyBase64 || typeof aesKeyBase64 !== 'string' || !aesKeyBase64.length) {
        throw new Error(`exportKeyToBase64 returned invalid value: ${typeof aesKeyBase64} (length: ${aesKeyBase64?.length || 0})`);
      }
      console.log('[Upload] Generated and exported AES key:', {
        keyLength: aesKeyBase64.length,
        keyPrefix: aesKeyBase64.substring(0, 20) + '...',
      });
    } catch (err: any) {
      throw new Error(`Failed to export AES key to base64: ${err?.message || String(err)}. This is required for encryption.`);
    }

    // Get owner's encryption keypair using signature-based derivation
    // CRITICAL: This encrypted key is required for on-chain registration
    // NO deprecated MetaMask APIs - uses signature-based key derivation
    if (!signer) {
      if (autoRegister) {
        throw new Error("Signer required for on-chain registration. Please connect your wallet.");
      } else {
        console.warn("[Upload] Signer not available, skipping encryption for owner");
      }
    } else {
      try {
        // Validate owner address
        if (!ownerAddr || typeof ownerAddr !== 'string' || !ownerAddr.startsWith('0x')) {
          throw new Error(`Invalid owner address for encryption: ${ownerAddr}`);
        }

        // Validate inputs before encryption
        if (!aesKeyBase64 || typeof aesKeyBase64 !== 'string') {
          throw new Error(`Invalid AES key format: expected string, got ${typeof aesKeyBase64}`);
        }
        
        if (!aesKeyBase64.length) {
          throw new Error('AES key is empty');
        }

        console.log('[Upload] Requesting signature to derive encryption keypair for owner:', {
          ownerAddr: ownerAddr,
        });

        // Derive encryption keypair from user signature (replaces deprecated eth_getEncryptionPublicKey)
        const { publicKeyBase64 } = await requestEncryptionKeypair(signer, ownerAddr);

        if (!publicKeyBase64 || typeof publicKeyBase64 !== 'string' || !publicKeyBase64.length) {
          throw new Error(`Invalid public key derived from signature: ${typeof publicKeyBase64}`);
        }

        console.log('[Upload] Derived encryption public key from signature:', {
          publicKeyLength: publicKeyBase64.length,
          publicKeyPrefix: publicKeyBase64.substring(0, 30) + '...',
        });

        console.log('[Upload] Encrypting AES key for owner using pure browser crypto...', {
          publicKeyLength: publicKeyBase64.length,
          publicKeyPrefix: publicKeyBase64.substring(0, 20),
          aesKeyLength: aesKeyBase64.length,
          aesKeyPrefix: aesKeyBase64.substring(0, 20),
        });

        // Use pure browser encryption (no deprecated MetaMask APIs)
        let encryptedObj: {
          version: string;
          ephemPublicKey: string;
          nonce: string;
          ciphertext: string;
        };
        
        try {
          encryptedObj = encryptForRecipient(publicKeyBase64, aesKeyBase64);
        } catch (err: any) {
          const errorMsg = err?.message || String(err);
          console.error('[Upload] Encryption failed:', err);
          throw new Error(`Failed to encrypt AES key: ${errorMsg}`);
        }
        
        if (!encryptedObj) {
          throw new Error("Encryption returned undefined result. The encrypt function failed silently.");
        }

        // Validate encrypted object structure
        if (typeof encryptedObj !== 'object' || encryptedObj === null) {
          throw new Error(`Invalid encrypted object type: ${typeof encryptedObj}. Expected object.`);
        }

        // Convert to string for storage
        const encryptedStr = JSON.stringify(encryptedObj);
        
        // CRITICAL: Defensive check before storing - this prevents the slice error downstream
        if (!encryptedStr || typeof encryptedStr !== 'string' || !encryptedStr.length) {
          console.error('[Upload] Encrypted string validation failed:', {
            encryptedStr: encryptedStr,
            type: typeof encryptedStr,
            length: encryptedStr?.length,
            encryptedObj: encryptedObj,
          });
          throw new Error(
            "Failed to create encrypted AES key string for on-chain registration. " +
            "The encrypted object could not be serialized to a valid JSON string."
          );
        }

        state.encryptedAesForOwner = encryptedStr;
        await set(sessionKey, state);
        console.log('[Upload] Successfully encrypted AES key for owner:', {
          encryptedStrLength: encryptedStr.length,
          encryptedStrPrefix: encryptedStr.substring(0, 50) + '...',
        });
      } catch (err: any) {
        const errorMsg = err?.message || String(err);
        console.error("[Upload] Failed to encrypt AES key for owner:", err);
        
        // If encryption fails, we cannot register on-chain
        // This is a critical error that should fail the upload if autoRegister is enabled
        if (autoRegister) {
          throw new Error(
            `Failed to encrypt AES key for on-chain registration: ${errorMsg}. ` +
            `This is required when autoRegister is enabled. ` +
            `Please check: 1) MetaMask is connected, 2) You approved the encryption request, 3) Browser supports required APIs.`
          );
        } else {
          // If autoRegister is false, warn but continue
          console.warn("[Upload] Encryption failed but autoRegister is disabled, continuing without on-chain registration");
        }
      }
    }
  }

  // Upload chunks
  let nextIndex = 0;
  let uploadedBytes = Object.values(state.uploaded).reduce(
    (sum, item) => sum + (item.size || 0),
    0
  );
  const results: Record<number, string> = {};
  for (const idxStr of Object.keys(state.uploaded)) {
    results[Number(idxStr)] = state.uploaded[Number(idxStr)].cid;
  }

  async function processChunk(i: number) {
    // Double-check: skip if already uploaded (safety check for race conditions)
    if (state.uploaded[i]) {
      return;
    }

    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, totalSize);
    const slice = file.slice(start, end);
    const arrBuf = await slice.arrayBuffer();

    if (!aesCryptoKey) {
      throw new Error("AES key not available");
    }

    // Encrypt chunk
    const { packed } = await encryptChunk(aesCryptoKey, arrBuf, i);

    // Upload chunk
    const cid = await uploadChunkWithRetries(packed, { proxyUrl, maxRetries });

    // Update state atomically - check again before writing to prevent race
    const currentState = await get(sessionKey);
    if (currentState && currentState.uploaded && currentState.uploaded[i]) {
      // Another worker already uploaded this chunk
      results[i] = currentState.uploaded[i].cid;
      return;
    }

    state.uploaded[i] = { cid, size: end - start };
    uploadedBytes += end - start;
    await set(sessionKey, state);
    results[i] = cid;

    if (onProgress) {
      const percent = Math.round((uploadedBytes / totalSize) * 100);
      onProgress(percent, uploadedBytes, totalSize);
    }
  }

  // Worker pool with atomic index allocation
  async function worker() {
    while (true) {
      // Atomically allocate next index (synchronous operation)
      // This prevents two workers from getting the same index
      let i: number | null = null;
      
      // Find next unuploaded index atomically
      // We need to check state.uploaded synchronously before any await
      while (nextIndex < totalChunks) {
        // Check if this index is already uploaded
        if (!state.uploaded[nextIndex]) {
          // Atomically claim this index by incrementing nextIndex
          i = nextIndex++;
          break;
        }
        // Skip already uploaded chunks
        nextIndex++;
      }

      // No more chunks to process
      if (i === null || i >= totalChunks) {
        return;
      }

      // Process the chunk (async operation)
      await processChunk(i);
    }
  }

  const workers = Array(concurrency)
    .fill(0)
    .map(() => worker());
  await Promise.all(workers);

  // Build metadata
  const chunks = [];
  for (let i = 0; i < totalChunks; i++) {
    chunks.push({
      index: i,
      cid: results[i],
      size: state.uploaded[i].size,
    });
  }

  const metadata = {
    type: "dcs-chunked-file",
    filename: state.filename,
    mimeType: state.mimeType,
    fileSize: state.fileSize,
    chunkSize: state.chunkSize,
    totalChunks,
    chunks,
    uploader: ownerAddr,
    uploadedAt: Math.floor(Date.now() / 1000),
  };

  // Upload metadata
  const metadataCid = await uploadMetadata(metadata, proxyUrl);
  state.metadataCid = metadataCid;
  await set(sessionKey, state);

  // Auto-register on-chain
  let txReceipt = null;
  console.log('[Upload] Auto-register check:', { autoRegister, hasSigner: !!signer, hasContract: !!contractAddress, hasEncryptedKey: !!state.encryptedAesForOwner });
  
  if (autoRegister && signer && contractAddress && state.encryptedAesForOwner) {
    try {
      // CRITICAL: Defensive check before encoding - this prevents the slice error
      const encryptedStr = state.encryptedAesForOwner;
      if (!encryptedStr || typeof encryptedStr !== 'string' || !encryptedStr.length) {
        console.error('[Upload] Encrypted string validation failed before on-chain registration:', {
          encryptedStr: encryptedStr,
          type: typeof encryptedStr,
          length: encryptedStr?.length,
          hasValue: !!encryptedStr,
        });
        throw new Error(
          "Failed to create encrypted AES key string for on-chain registration (value missing or invalid). " +
          "The encrypted key was not properly generated during upload. Please re-upload the file."
        );
      }

      console.log('[Upload] Starting on-chain registration...', {
        contractAddress,
        metadataCid,
        encryptedKeyLength: encryptedStr.length,
        encryptedKeyPrefix: encryptedStr.substring(0, 50) + '...',
      });
      
      // Use contract ABI
      const contract = new Contract(
        contractAddress,
        CONTRACT_ABI,
        signer
      );

      // Safe to encode now - we've validated encryptedStr is a non-empty string
      const encBytes = new TextEncoder().encode(encryptedStr);
      console.log('[Upload] Encrypted key bytes length:', encBytes.length);
      
      // Estimate gas first
      let gasEstimate;
      try {
        console.log('[Upload] Estimating gas...');
        gasEstimate = await contract.estimateGas.uploadFile(metadataCid, encBytes);
        console.log('[Upload] Gas estimate:', gasEstimate.toString());
      } catch (gasErr: any) {
        console.warn("[Upload] Gas estimation failed:", gasErr);
        // Continue without gas estimate
      }

      // Send transaction with error handling
      const txOptions: any = {};
      if (gasEstimate) {
        // Add 20% buffer to gas estimate
        txOptions.gasLimit = gasEstimate.mul(120).div(100);
        console.log('[Upload] Using gas limit:', txOptions.gasLimit.toString());
      }
      
      console.log('[Upload] Sending uploadFile transaction...');
      const tx = await contract.uploadFile(metadataCid, encBytes, txOptions);
      console.log('[Upload] Transaction sent:', tx.hash);
      
      // Wait for confirmation with timeout
      const timeout = 120000; // 2 minutes
      const txPromise = tx.wait(1);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Transaction timeout')), timeout)
      );
      
      console.log('[Upload] Waiting for transaction confirmation...');
      txReceipt = await Promise.race([txPromise, timeoutPromise]) as any;
      console.log('[Upload] Transaction confirmed:', txReceipt.transactionHash);

      state.registeredAt = Math.floor(Date.now() / 1000);
      state.onChainTx = txReceipt.transactionHash;
      await set(sessionKey, state);
      console.log('[Upload] On-chain registration successful!');
    } catch (err: any) {
      console.error("[Upload] On-chain registration failed:", err);
      console.error("[Upload] Error details:", {
        code: err.code,
        message: err.message,
        data: err.data,
        reason: err.reason
      });
      
      // Don't throw - allow upload to complete even if on-chain registration fails
      // User can manually register later
      if (err.code === 4001) {
        throw new Error("User rejected transaction");
      }
      if (err.message?.includes('timeout')) {
        throw new Error("Transaction timeout - please check network");
      }
      
      // Provide more detailed error message
      const errorMsg = err.reason || err.message || String(err);
      throw new Error(`On-chain registration failed: ${errorMsg}. Please check: 1) Contract address is correct, 2) You're on the correct network, 3) You have enough gas.`);
    }
  } else {
    console.warn('[Upload] On-chain registration skipped:', {
      autoRegister,
      hasSigner: !!signer,
      hasContract: !!contractAddress,
      hasEncryptedKey: !!state.encryptedAesForOwner
    });
  }

  // Clear in-memory keys
  aesCryptoKey = null;
  aesKeyBase64 = null;

  return { metadataCid, metadata, sessionKey, txReceipt };
}

