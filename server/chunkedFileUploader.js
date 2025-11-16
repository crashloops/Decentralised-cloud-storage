// Updated chunkedUploadFile (auto-register & never persist raw AES key)
//
// Assumes the file contains the other helper functions previously present:
// - idbGet, idbSet, idbDel
// - encryptChunk, uploadChunkWithRetries, uploadToNFTStorage, fetchBlobFromGateway
// - generateUploadId, defaultChunkSize, sleep
// - cryptoService exports: generateAESKey, exportKeyToBase64, importKeyFromBase64
// - CONTRACT_ABI is available for contract interactions (you can import or pass via param)

import { generateAESKey, exportKeyToBase64, importKeyFromBase64 } from "./cryptoService";
import { uploadToNFTStorage } from "./nftService";
import { Contract } from "ethers";
import CONTRACT_ABI from "../contracts/TimeBoundFileRegistry.abi.json";

/**
 * chunkedUploadFile (updated)
 *
 * - encrypts chunks with AES-GCM (fresh IV per chunk, AAD = chunkIndex)
 * - uploads chunks to nft.storage (via proxy or direct)
 * - persists session state in IDB, but NEVER stores raw AES key
 * - stores AES key encrypted for owner in session (encryptedAesForOwner JSON string)
 * - automatically registers metadataCid on-chain by calling contract.uploadFile(metadataCid, encryptedBytes)
 *
 * @param {File} file
 * @param {Object} opts - {
 *   ownerAddr, signer, contractAddress,
 *   chunkSize, concurrency, token, proxyUrl,
 *   autoRegister (bool), onProgress(percent, uploadedBytes, totalBytes),
 *   maxRetries
 * }
 *
 * @returns {Promise<{ metadataCid, metadata, sessionKey, txReceipt?:object }>}
 */
export async function chunkedUploadFile(file, opts = {}) {
  const {
    ownerAddr = "anon",
    signer = null,
    contractAddress = null,
    chunkSize = defaultChunkSize(),
    concurrency = 2,
    token = null,
    proxyUrl = null,
    filename = file.name,
    mimeType = file.type || "application/octet-stream",
    maxRetries = 3,
    onProgress = null,
    autoRegister = true
  } = opts;

  if (autoRegister && (!signer || !contractAddress)) {
    throw new Error("autoRegister requires signer and contractAddress");
  }

  // session key to store per-upload metadata (not raw AES key)
  const sessionKey = generateUploadId(ownerAddr);
  const totalSize = file.size;
  const totalChunks = Math.ceil(totalSize / chunkSize);

  // session state skeleton
  let state = (await idbGet(sessionKey)) || {
    uploadId: sessionKey,
    filename,
    mimeType,
    fileSize: totalSize,
    chunkSize,
    totalChunks,
    uploaded: {}, // index -> { cid, size }
    encryptedAesForOwner: null, // JSON string encrypted for owner (x25519...)
    metadataCid: null,
    // Do NOT store aesKeyBase64 here
  };

  // 1) Prepare AES key (in-memory) and owner-encrypted key persist
  let aesCryptoKey = null;      // CryptoKey kept in memory for chunk encryption
  let aesKeyBase64_local = null; // base64 string kept in-memory only (not stored)

  // If state.encryptedAesForOwner exists, user may be resuming after page reload.
  if (state.encryptedAesForOwner) {
    // we need to obtain raw AES key by asking MetaMask to decrypt it
    if (!window.ethereum || !window.ethereum.request) {
      throw new Error("Resume requires MetaMask to decrypt the AES key.");
    }
    // ask MetaMask to decrypt: eth_decrypt(encryptedJson, ownerAddr)
    try {
      const decryptedBase64 = await window.ethereum.request({
        method: "eth_decrypt",
        params: [state.encryptedAesForOwner, ownerAddr]
      });
      // import crypto key
      aesKeyBase64_local = decryptedBase64;
      aesCryptoKey = await importKeyFromBase64(aesKeyBase64_local);
    } catch (err) {
      throw new Error("Failed to decrypt AES key from session: " + (err.message || err));
    }
  } else {
    // fresh session: generate AES key and *immediately* create encryptedAesForOwner and persist it.
    // We require MetaMask to get owner's encryption public key to create encryptedAesForOwner.
    // This gives us resumability while never persisting the raw AES key.
    // Generate AES key
    const genKey = await generateAESKey();
    aesCryptoKey = genKey;
    aesKeyBase64_local = await exportKeyToBase64(genKey); // kept in-memory only

    // Get owner's public encryption key from MetaMask
    if (!window.ethereum || !window.ethereum.request) {
      throw new Error("MetaMask required to encrypt AES key for owner for resumability.");
    }

    let publicKey;
    try {
      publicKey = await window.ethereum.request({
        method: "eth_getEncryptionPublicKey",
        params: [ownerAddr]
      });
    } catch (err) {
      // user may reject; in that case we still allow upload in current session (without resumability)
      // but we will not be able to resume later.
      console.warn("User rejected eth_getEncryptionPublicKey or method unavailable. Upload will proceed, but resume across sessions disabled.");
      publicKey = null;
    }

    if (publicKey) {
      // dynamically import eth-sig-util to encrypt AES base64
      let mmEncrypt;
      try {
        mmEncrypt = (await import("@metamask/eth-sig-util")).encrypt;
      } catch (err) {
        console.warn("Could not load @metamask/eth-sig-util; resume across sessions will not be available.", err);
        mmEncrypt = null;
      }

      if (mmEncrypt) {
        const encryptedObj = mmEncrypt({
          publicKey: publicKey,
          data: aesKeyBase64_local,
          version: "x25519-xsalsa20-poly1305"
        });
        const encryptedStr = JSON.stringify(encryptedObj);
        state.encryptedAesForOwner = encryptedStr; // store encrypted AES key for resumability
        // persist state (still no raw AES key stored)
        await idbSet(sessionKey, state);
      }
    } else {
      // no publicKey: leave state.encryptedAesForOwner null => resumability disabled
      await idbSet(sessionKey, state);
    }
  }

  // Upload loop: concurrency workers
  let nextIndex = 0;
  let uploadedBytes = Object.values(state.uploaded).reduce((s, t) => s + (t.size || 0), 0);
  const results = {};
  for (const idxStr of Object.keys(state.uploaded)) {
    results[Number(idxStr)] = state.uploaded[idxStr].cid;
  }

  let aborted = false;

  async function processChunk(i) {
    if (state.uploaded[i]) return;
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, totalSize);
    const slice = file.slice(start, end);
    const arrBuf = await slice.arrayBuffer();

    // Encrypt chunk with aesCryptoKey (must exist in memory)
    if (!aesCryptoKey) {
      // attempt to recover via eth_decrypt if encryptedAesForOwner present
      if (state.encryptedAesForOwner) {
        const decryptedBase64 = await window.ethereum.request({
          method: "eth_decrypt",
          params: [state.encryptedAesForOwner, ownerAddr]
        });
        aesKeyBase64_local = decryptedBase64;
        aesCryptoKey = await importKeyFromBase64(aesKeyBase64_local);
      } else {
        throw new Error("AES key not available in memory and no encrypted session key present; cannot encrypt chunk.");
      }
    }

    // Use encryptChunk helper that uses AAD = chunkIndex to encrypt
    const { packed } = await encryptChunk(aesCryptoKey, arrBuf, i);

    // Upload chunk
    const cid = await uploadChunkWithRetries(packed, { token, proxyUrl, maxRetries });

    state.uploaded[i] = { cid, size: end - start };
    uploadedBytes += (end - start);
    await idbSet(sessionKey, state);
    results[i] = cid;

    if (onProgress) {
      const percent = Math.round((uploadedBytes / totalSize) * 100);
      onProgress(percent, uploadedBytes, totalSize);
    }
  }

  async function worker() {
    while (!aborted) {
      // find next index not uploaded
      let i;
      while (state.uploaded[nextIndex]) {
        nextIndex++;
        if (nextIndex >= totalChunks) return;
      }
      i = nextIndex;
      nextIndex++;
      await processChunk(i);
      if (nextIndex >= totalChunks) return;
    }
  }

  // start workers
  const workers = new Array(concurrency).fill(0).map(() => worker());
  await Promise.all(workers);

  // Build metadata JSON and upload
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

  // Upload metadata JSON
  const metaBlob = new Blob([JSON.stringify(metadata)], { type: "application/json" });
  let metadataCid;
  if (proxyUrl) {
    // proxy may expose metadata endpoint
    const form = new FormData();
    form.append("file", metaBlob, `${filename}.metadata.json`);
    const res = await fetch(proxyUrl + "/metadata", { method: "POST", body: form });
    if (!res.ok) throw new Error("Metadata upload via proxy failed");
    const j = await res.json();
    metadataCid = j.cid;
  } else {
    if (!token) throw new Error("NFT storage token required for metadata upload in dev mode");
    metadataCid = await uploadToNFTStorage(metaBlob, { token });
  }

  // update state with metadataCid
  state.metadataCid = metadataCid;
  await idbSet(sessionKey, state);

  // AUTO-REGISTER ON-CHAIN (if requested)
  let txReceipt = null;
  if (autoRegister) {
    // We must have state.encryptedAesForOwner (otherwise we can't get a stored encrypted key)
    // If not present, but we have aesKeyBase64_local in memory, create encryptedAesForOwner now
    if (!state.encryptedAesForOwner) {
      // attempt to get owner's public key and create encrypted blob now
      if (!window.ethereum || !window.ethereum.request) {
        throw new Error("MetaMask required to create owner-encrypted AES key for registration.");
      }
      // request public key
      let publicKey;
      try {
        publicKey = await window.ethereum.request({ method: "eth_getEncryptionPublicKey", params: [ownerAddr] });
      } catch (err) {
        // cannot continue auto-register without an encrypted session key
        throw new Error("Cannot obtain owner's public key for registration: " + (err.message || err));
      }
      const mmEncrypt = (await import("@metamask/eth-sig-util")).encrypt;
      const encryptedObj = mmEncrypt({ publicKey, data: aesKeyBase64_local, version: "x25519-xsalsa20-poly1305" });
      const encryptedStr = JSON.stringify(encryptedObj);
      state.encryptedAesForOwner = encryptedStr;
      await idbSet(sessionKey, state);
    }

    // Now convert encrypted string to bytes and call contract.uploadFile(metadataCid, encryptedBytes)
    // encryptedStr = state.encryptedAesForOwner
    const encStr = state.encryptedAesForOwner;
    const encBytes = new TextEncoder().encode(encStr); // Uint8Array

    // Use signer to call contract.uploadFile
    const contract = new Contract(contractAddress, CONTRACT_ABI, signer);
    const tx = await contract.uploadFile(metadataCid, encBytes);
    const receipt = await tx.wait(1);
    txReceipt = receipt;

    // mark registeredAt and txhash in session; REMOVE raw AES base64 from memory
    state.registeredAt = Math.floor(Date.now() / 1000);
    state.onChainTx = receipt.transactionHash;
    await idbSet(sessionKey, state);
    // discard in-memory base64 / CryptoKey for safety
    aesCryptoKey = null;
    aesKeyBase64_local = null;
  }

  // Return metadataCid + sessionKey + optional txReceipt
  return { metadataCid, metadata, sessionKey, txReceipt };
}
