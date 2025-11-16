// src/services/chunkedService.js
// Chunked upload / download helpers (AES-GCM per-chunk, resumable via IndexedDB)

import { exportKeyToBase64, importKeyFromBase64 } from "./cryptoService";
import { uploadToNFTStorage, uploadFileWithMetadata, fetchBlobFromGateway } from "./nftService";
import { arrayBufferToBase64 } from "./cryptoService";

/* -------------------------
   Tiny IndexedDB session store
   ------------------------- */
const IDB_DB = "dcs_chunked_store_v1";
const IDB_STORE = "uploads";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbGet(key) {
  const db = await openDb();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const store = tx.objectStore(IDB_STORE);
    const r = store.get(key);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbSet(key, val) {
  const db = await openDb();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    const store = tx.objectStore(IDB_STORE);
    const r = store.put(val, key);
    r.onsuccess = () => res(true);
    r.onerror = () => rej(r.error);
  });
}

// Debounced persistence helper to reduce IDB write thrash
let _persistTimers = new Map(); // key -> timer

/**
 * schedulePersist - Debounced persistence that strips raw AES keys
 * @param {string} sessionKey - Session key
 * @param {object} state - State object (will have aesKeyBase64 removed before persisting)
 */
function schedulePersist(sessionKey, state) {
  // Clear existing timer for this session
  if (_persistTimers.has(sessionKey)) {
    clearTimeout(_persistTimers.get(sessionKey));
  }
  
  // Schedule debounced write
  const timer = setTimeout(async () => {
    try {
      // CRITICAL: Remove raw AES before persisting
      const copy = { ...state };
      delete copy.aesKeyBase64;
      await idbSet(sessionKey, copy);
      _persistTimers.delete(sessionKey);
    } catch (e) {
      console.error('Persist failed', e);
      _persistTimers.delete(sessionKey);
    }
  }, 800); // 800ms debounce
  
  _persistTimers.set(sessionKey, timer);
}
async function idbDel(key) {
  const db = await openDb();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    const store = tx.objectStore(IDB_STORE);
    const r = store.delete(key);
    r.onsuccess = () => res(true);
    r.onerror = () => rej(r.error);
  });
}

/* -------------------------
   Helpers
   ------------------------- */
function defaultChunkSize() {
  return 5 * 1024 * 1024; // 5 MB
}
function generateUploadId(ownerAddr) {
  return `${ownerAddr || "anon"}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/* -------------------------
   encryptChunk
   - chunkBuffer: ArrayBuffer (plain)
   - aesKey: CryptoKey
   - chunkIndex: number used in AAD
   returns: { packed: Blob, iv:Uint8Array, ciphertext:ArrayBuffer }
   ------------------------- */
export async function encryptChunk(aesKey, chunkBuffer, chunkIndex) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  // AAD = chunk index (as UTF-8 bytes) - binds chunk to order
  const aad = new TextEncoder().encode(String(chunkIndex));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad },
    aesKey,
    chunkBuffer
  );
  // pack iv + ciphertext (same format as single-blob)
  const ivBuf = iv.buffer;
  const combined = new Uint8Array(ivBuf.byteLength + ciphertext.byteLength);
  combined.set(new Uint8Array(ivBuf), 0);
  combined.set(new Uint8Array(ciphertext), ivBuf.byteLength);
  const blob = new Blob([combined.buffer], { type: "application/octet-stream" });
  return { packed: blob, iv, ciphertext };
}

/* -------------------------
   uploadChunkWithRetries
   - send the packed Blob to nft.storage (or proxy)
   - returns: CID string
   ------------------------- */
export async function uploadChunkWithRetries(packedBlob, opts = {}) {
  const { token, proxyUrl, maxRetries = 3, backoffBase = 1000 } = opts;
  let attempt = 0;
  while (true) {
    try {
      // Prefer proxyUrl if provided (recommended for prod)
      if (proxyUrl) {
        // proxy expects multipart/form-data; adapt to your proxy signature
        const form = new FormData();
        form.append("file", packedBlob, "chunk.bin");
        const res = await fetch(proxyUrl, { method: "POST", body: form });
        if (!res.ok) throw new Error(`Proxy upload failed: ${res.status}`);
        const json = await res.json();
        if (!json.cid) throw new Error("Proxy response missing cid");
        return json.cid;
      } else {
        // Direct to nft.storage (dev)
        if (!token) throw new Error("NFT_STORAGE_TOKEN required for direct uploads");
        const cid = await uploadToNFTStorage(packedBlob, { token, maxRetries: 0 });
        return cid;
      }
    } catch (err) {
      attempt++;
      if (attempt > maxRetries) throw err;
      await sleep(backoffBase * Math.pow(2, attempt - 1));
    }
  }
}

/* -------------------------
   chunkedUploadFile
   - file: File object
   - opts:
       ownerAddr: owner address (for uploadId)
       chunkSize (bytes)
       concurrency (number)
       token (nft.storage token) OR proxyUrl (recommended)
       onProgress(percent, uploadedBytes, totalBytes)
   - returns: metadata object with metadataCid and metadata JSON
   ------------------------- */
export async function chunkedUploadFile(file, opts = {}) {
  const {
    ownerAddr = "anon",
    chunkSize = defaultChunkSize(),
    concurrency = 2,
    token,
    proxyUrl,
    filename = file.name,
    mimeType = file.type || "application/octet-stream",
    maxRetries = 3,
    persistKey // optional unique key to store session; defaults to uploadId
  } = opts;

  const uploadId = generateUploadId(ownerAddr);
  const totalSize = file.size;
  const totalChunks = Math.ceil(totalSize / chunkSize);
  const sessionKey = persistKey || uploadId;

  // Try to load existing state for resume
  const existing = await idbGet(sessionKey) || { uploadId: sessionKey, uploaded: {} };

  // If this is a fresh session, store initial state
  const state = {
    uploadId: existing.uploadId || sessionKey,
    filename,
    mimeType,
    fileSize: totalSize,
    chunkSize,
    totalChunks,
    uploaded: existing.uploaded || {}, // { index: { cid, size } }
    encryptedAesForOwner: existing.encryptedAesForOwner || null // Preserve encrypted key if exists
  };

  // CRITICAL: Never persist raw AES - strip it if it exists in existing state
  delete state.aesKeyBase64;
  await idbSet(sessionKey, state);
  
  // In-memory AES key (not persisted)
  // For resume, caller must provide resumeAesKeyBase64 (from eth_decrypt of encryptedAesForOwner)
  let inMemoryAesKeyBase64 = resumeAesKeyBase64 || null;

  // concurrency-controlled worker pool
  let active = 0;
  let nextIndex = 0;
  let aborted = false;
  let uploadedBytes = Object.values(state.uploaded).reduce((s, t) => s + (t.size || 0), 0);

  const results = {}; // index -> cid

  // populate results with already uploaded
  for (const idxStr of Object.keys(state.uploaded)) {
    const idx = Number(idxStr);
    results[idx] = state.uploaded[idx].cid;
  }

  // helper to process a single chunk at index i
  async function processChunk(i) {
    if (state.uploaded[i]) return; // already uploaded
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, totalSize);
    const slice = file.slice(start, end);
    const arrBuf = await slice.arrayBuffer();

    // Generate or retrieve AES key
    // SECURITY: Raw AES keys are NEVER persisted to IndexedDB.
    // For resume across page reloads, user must decrypt encryptedAesForOwner via eth_decrypt.
    // Within the same session, we keep the key in memory only.
    let aesKey;
    if (!inMemoryAesKeyBase64) {
      // Check if we have encrypted key for resume (requires user to decrypt)
      if (state.encryptedAesForOwner) {
        // Resume scenario: require user to decrypt via eth_decrypt
        // This should be handled by the caller before calling chunkedUploadFile
        throw new Error("Resume requires decryption of encryptedAesForOwner. Caller must decrypt via eth_decrypt and pass raw key.");
      }
      
      // Fresh session: generate extractable key (needed for owner encryption)
      const { generateExtractableAESKey } = await import("./cryptoService");
      const genKey = await generateExtractableAESKey();
      const { exportKeyToBase64 } = await import("./cryptoService");
      // Keep in memory only - will be encrypted and stored as encryptedAesForOwner
      inMemoryAesKeyBase64 = await exportKeyToBase64(genKey);
      aesKey = genKey;
    } else {
      // Use in-memory key (same session resume)
      aesKey = await (await import("./cryptoService")).importKeyFromBase64(inMemoryAesKeyBase64);
    }

    // encrypt chunk
    const { packed } = await encryptChunk(aesKey, arrBuf, i);

    // upload
    const cid = await uploadChunkWithRetries(packed, { token, proxyUrl, maxRetries });

    // Store chunk metadata
    state.uploaded[i] = { cid, size: end - start };
    uploadedBytes += (end - start);
    // Use debounced persist (strips raw AES automatically)
    // Note: inMemoryAesKeyBase64 is not in state, so it won't be persisted
    schedulePersist(sessionKey, state);
    results[i] = cid;

    if (opts.onProgress && typeof opts.onProgress === "function") {
      const percent = Math.round((uploadedBytes / totalSize) * 100);
      opts.onProgress(percent, uploadedBytes, totalSize);
    }
  }

  // worker loop with atomic index allocation (prevents race conditions)
  async function worker() {
    while (!aborted) {
      // Atomically claim next index (synchronous operation prevents race)
      const i = nextIndex++;
      if (i >= totalChunks) return;
      
      // Skip if already uploaded (safety check)
      if (state.uploaded && state.uploaded[i]) continue;
      
      await processChunk(i);
    }
  }

  // start workers
  const workers = new Array(concurrency).fill(0).map(() => worker());
  await Promise.all(workers);

  // All chunks uploaded; build metadata JSON
  const chunks = [];
  for (let i = 0; i < totalChunks; i++) {
    chunks.push({ index: i, cid: results[i], size: state.uploaded[i].size });
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
    uploadedAt: Math.floor(Date.now() / 1000)
  };

  // upload metadata JSON to nft.storage
  const metaBlob = new Blob([JSON.stringify(metadata)], { type: "application/json" });
  // use uploadFileWithMetadata or uploadToNFTStorage
  let metadataCid;
  if (proxyUrl) {
    // if proxy supports metadata
    const form = new FormData();
    form.append("file", metaBlob, `${filename}.metadata.json`);
    const res = await fetch(proxyUrl + "/metadata", { method: "POST", body: form });
    if (!res.ok) throw new Error("Metadata upload failed via proxy");
    const j = await res.json();
    metadataCid = j.cid;
  } else {
    if (!token) throw new Error("NFT storage token required for direct metadata upload");
    // use uploadToNFTStorage for raw blob
    metadataCid = await uploadToNFTStorage(metaBlob, { token });
  }

  // Update session with metadataCid
  // CRITICAL: Do NOT persist raw AES. Only persist encryptedAesForOwner if it exists.
  state.metadataCid = metadataCid;
  state.uploadedAt = Math.floor(Date.now() / 1000);
  // Remove raw AES before final persist
  delete state.aesKeyBase64;
  await idbSet(sessionKey, state);

  return { metadataCid, metadata, sessionKey };
}

/* -------------------------
   chunkedDownloadFile
   - metadataCid: cid of the metadata JSON created during upload
   - aesKeyBase64: base64 raw AES key (obtained via eth_decrypt using the on-chain encrypted key)
   - opts: { onProgress(percent), useFileSystemHandle } 
   - returns: { success, filename }
   ------------------------- */
/**
 * Validate CID format to prevent injection attacks
 */
function validateCID(cid) {
  // Basic CID validation: should start with 'b' (base32) or 'Qm' (base58)
  return /^[bBQm][a-zA-Z0-9]+$/.test(cid);
}

/**
 * Fetch blob from gateway with timeout and retry
 */
async function fetchBlobFromGatewayWithTimeout(cid, timeoutMs = 60000, maxRetries = 3) {
  if (!validateCID(cid)) {
    throw new Error(`Invalid CID format: ${cid}`);
  }
  
  const url = `https://${cid}.ipfs.nftstorage.link/`;
  let lastError = null;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const ac = new AbortController();
      const timeout = setTimeout(() => ac.abort(), timeoutMs);
      
      try {
        const resp = await fetch(url, { 
          method: "GET", 
          cache: "no-store",
          signal: ac.signal 
        });
        clearTimeout(timeout);
        
        if (!resp.ok) {
          throw new Error(`Gateway fetch failed: ${resp.status} ${resp.statusText}`);
        }
        return await resp.arrayBuffer();
      } finally {
        clearTimeout(timeout);
      }
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries - 1) {
        // Exponential backoff
        await sleep(1000 * Math.pow(2, attempt));
      }
    }
  }
  
  throw lastError || new Error(`Failed to fetch CID ${cid} after ${maxRetries} attempts`);
}

/**
 * chunkedDownloadFile
 * 
 * SECURITY: aesKeyBase64 must come from a user-driven eth_decrypt call.
 * Never pass a key that was persisted to storage. Keys should be in-memory only.
 * 
 * @param {string} metadataCid - CID of metadata JSON
 * @param {string} aesKeyBase64 - Raw AES key (from eth_decrypt, in-memory only)
 * @param {object} opts - Options
 */
export async function chunkedDownloadFile(metadataCid, aesKeyBase64, opts = {}) 
{
  const { onProgress, timeoutMs = 120000 } = opts;
  
  // Validate inputs
  if (!metadataCid || !validateCID(metadataCid)) {
    throw new Error("Invalid metadata CID format");
  }
  if (!aesKeyBase64 || typeof aesKeyBase64 !== "string") {
    throw new Error("Invalid AES key: must be a base64 string");
  }
  
  // 1) fetch metadata JSON
  const metaBuf = await fetchBlobFromGatewayWithTimeout(metadataCid, timeoutMs);
  let metadata;
  try {
    const metaText = new TextDecoder().decode(metaBuf);
    metadata = JSON.parse(metaText);
  } catch (err) {
    throw new Error("Invalid metadata JSON format");
  }
  
  // Validate metadata structure
  if (metadata.type !== "dcs-chunked-file") {
    throw new Error("Invalid metadata type");
  }
  if (!metadata.chunks || !Array.isArray(metadata.chunks) || metadata.chunks.length === 0) {
    throw new Error("Invalid metadata: missing or empty chunks array");
  }
  if (!metadata.filename || typeof metadata.filename !== "string") {
    throw new Error("Invalid metadata: missing filename");
  }
  
  const { filename, mimeType, fileSize, chunks } = metadata;

  // 2) import AES key
  const aesKey = await importKeyFromBase64(aesKeyBase64);

  // 3) prepare writer: try File System Access API
  let useFs = false;
  let writable = null;
  let fileHandle = null;
  if ('showSaveFilePicker' in window) {
    try {
      fileHandle = await window.showSaveFilePicker({
        suggestedName: filename || `file_${metadataCid}`,
        types: [{ description: mimeType || "File", accept: { [mimeType || 'application/octet-stream']: ['.bin'] } }]
      });
      writable = await fileHandle.createWritable();
      useFs = true;
    } catch (e) {
      // user cancelled, fallback to blob assemble
      useFs = false;
    }
  }

  const parts = []; // if not using FS, store decrypted chunks as Blobs

  let downloadedBytes = 0;
  for (let i = 0; i < chunks.length; i++) {
    const chunkMeta = chunks[i];
    if (!chunkMeta) {
      throw new Error(`Missing chunk metadata at index ${i}`);
    }
    if (chunkMeta.index !== i) {
      throw new Error(`Chunk index mismatch: expected ${i}, got ${chunkMeta.index}`);
    }
    const { cid } = chunkMeta;
    
    // Validate chunk CID
    if (!cid || !validateCID(cid)) {
      throw new Error(`Invalid chunk CID at index ${i}: ${cid}`);
    }
    
    // fetch chunk with timeout and retry
    const arrBuf = await fetchBlobFromGatewayWithTimeout(cid, timeoutMs);
    // unpack iv + ciphertext
    const full = new Uint8Array(arrBuf);
    if (full.length < 13) throw new Error("Chunk corrupted / too small");
    const iv = full.slice(0, 12);
    const ciphertext = full.slice(12).buffer;
    // AAD = chunk index
    const aad = new TextEncoder().encode(String(i));
    // decrypt with AES-GCM, passing iv and aad
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: aad }, aesKey, ciphertext);

    downloadedBytes += plain.byteLength;
    if (onProgress && fileSize) {
      onProgress(Math.round((downloadedBytes / fileSize) * 100), downloadedBytes, fileSize);
    }

    if (useFs) {
      // write chunk to writable stream
      await writable.write(new Uint8Array(plain));
    } else {
      parts.push(new Blob([plain], { type: mimeType || "application/octet-stream" }));
    }
  }

  if (useFs) {
    await writable.close();
    return { success: true, filename: filename || `file_${metadataCid}` };
  } else {
    // assemble blob and trigger download
    const finalBlob = new Blob(parts, { type: mimeType || "application/octet-stream" });
    const url = URL.createObjectURL(finalBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || `file_${metadataCid}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60 * 1000);
    return { success: true, filename: filename || `file_${metadataCid}` };
  }
}

// -------------------------
// Helpers: getSessionAesKey & registerSessionOnChain
// -------------------------
import { Contract } from "ethers";
import CONTRACT_ABI from "../contracts/TimeBoundFileRegistry.abi.json"; // adjust path if needed
import { arrayBufferToBase64 } from "./cryptoService"; // already in cryptoService

// Note: we import eth-sig-util only when needed to avoid bundler surprises
// We'll use the named import 'encrypt' aliased as mmEncrypt in the function.

/**
 * getSessionEncryptedForOwner - Safe replacement for getSessionAesKey
 * Returns only encryptedAesForOwner (JSON string) and metadataCid.
 * NEVER returns raw AES keys from storage.
 * 
 * SECURITY: Raw AES keys must never be persisted to IndexedDB.
 * This function returns the owner-encrypted blob which requires eth_decrypt to retrieve the raw key.
 */
export async function getSessionEncryptedForOwner(sessionKey) {
  const state = await idbGet(sessionKey);
  if (!state) throw new Error("Session not found");
  if (!state.metadataCid) throw new Error("metadataCid not found in session (upload incomplete?)");
  // Return only encrypted blob OR null if not present
  return { 
    encryptedAesForOwner: state.encryptedAesForOwner || null, 
    metadataCid: state.metadataCid, 
    session: state 
  };
}

/**
 * @deprecated Use getSessionEncryptedForOwner instead. This function is unsafe.
 */
export async function getSessionAesKey(sessionKey) {
  throw new Error("getSessionAesKey is deprecated and unsafe. Use getSessionEncryptedForOwner instead. Raw AES keys are never persisted to storage.");
}

/**
 * registerSessionOnChain - Safe version that requires raw AES key as parameter
 * 
 * SECURITY: Do NOT read raw AES keys from IndexedDB. This function requires
 * the caller to provide rawAesBase64 as an in-memory parameter.
 * 
 * @param {string} sessionKey - IDB key returned by chunkedUploadFile
 * @param {string} contractAddress - Address of TimeBoundFileRegistry
 * @param {ethers.Signer} signer - Owner's signer connected to MetaMask
 * @param {string} rawAesBase64 - Raw AES key in base64 (must be in-memory, never from storage)
 * 
 * Steps:
 *  - read session -> get metadataCid (NOT raw AES)
 *  - encrypt rawAesBase64 with owner's public key
 *  - call contract.uploadFile(metadataCid, encryptedBytes)
 *  - persist encryptedAesForOwner to session (NOT raw key)
 *  - return tx receipt
 */
export async function registerSessionOnChain(sessionKey, contractAddress, signer, rawAesBase64) {
  if (!sessionKey) throw new Error("sessionKey required");
  if (!contractAddress) throw new Error("contractAddress required");
  if (!signer) throw new Error("ethers.Signer required");
  if (!rawAesBase64) throw new Error("rawAesBase64 required (do not store raw AES in DB)");

  // 1) retrieve session
  const state = await idbGet(sessionKey);
  if (!state) throw new Error("Session not found");
  const { metadataCid } = state;
  if (!metadataCid) throw new Error("metadataCid missing in session");

  // 2) get owner address from signer
  const ownerAddr = await signer.getAddress();

  // 3) request MetaMask public encryption key for ownerAddr
  if (!window.ethereum || !window.ethereum.request) throw new Error("MetaMask not available");
  let publicKey;
  try {
    publicKey = await window.ethereum.request({
      method: "eth_getEncryptionPublicKey",
      params: [ownerAddr]
    });
  } catch (err) {
    // user may reject or method not available
    throw new Error("Could not get encryption public key from MetaMask: " + (err.message || err));
  }

  // 4) encrypt aesKeyBase64 with the publicKey using eth-sig-util
  // import dynamically to avoid bundler issues if not used elsewhere
  let mmEncrypt;
  try {
    // eslint-disable-next-line import/no-extraneous-dependencies, node/no-extraneous-import
    mmEncrypt = (await import("@metamask/eth-sig-util")).encrypt;
  } catch (err) {
    throw new Error("Failed to load @metamask/eth-sig-util for encryption: " + (err.message || err));
  }

  const encryptedObj = mmEncrypt({
    publicKey: publicKey,
    data: rawAesBase64, // Use parameter, not from storage
    version: "x25519-xsalsa20-poly1305"
  });

  const encryptedStr = JSON.stringify(encryptedObj);
  const encryptedBytes = new TextEncoder().encode(encryptedStr); // Uint8Array

  // 5) call contract.uploadFile(metadataCid, encryptedBytes)
  const contract = new Contract(contractAddress, CONTRACT_ABI, signer);

  // Make the contract call
  let tx;
  try {
    tx = await contract.uploadFile(metadataCid, encryptedBytes);
  } catch (err) {
    throw new Error("Contract uploadFile transaction failed: " + (err.message || err));
  }

  // 6) wait for confirmation
  const receipt = await tx.wait(1);
  
  // Update session metadata: persist encryptedAesForOwner only (NOT raw)
  state.encryptedAesForOwner = encryptedStr;
  state.onChainTx = receipt.transactionHash;
  state.registeredAt = Math.floor(Date.now() / 1000);
  
  // CRITICAL: Ensure we DO NOT persist any raw AES in state
  delete state.aesKeyBase64;
  
  await idbSet(sessionKey, state);

  return receipt;
}

