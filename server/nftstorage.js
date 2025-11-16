// src/services/nftService.js
import { NFTStorage } from "nft.storage";

/**
 * uploadToNFTStorage - upload a Blob and return CID (raw CID string)
 * @param {Blob|File} blob
 * @param {Object} opts { token, maxRetries=2, timeoutMs=300000 }
 * @returns {Promise<string>}
 */
export async function uploadToNFTStorage(blob, opts = {}) {
  const { token, maxRetries = 2, timeoutMs = 5 * 60 * 1000 } = opts;
  if (!token) throw new Error("NFT_STORAGE_TOKEN_REQUIRED");

  // create client per-call is fine, but we can reuse; keep simple
  const client = new NFTStorage({ token });

  let attempt = 0;
  while (true) {
    try {
      attempt++;
      const cidPromise = client.storeBlob(blob);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("NFT_UPLOAD_TIMEOUT")), timeoutMs)
      );
      const cid = await Promise.race([cidPromise, timeoutPromise]);
      return cid;
    } catch (err) {
      if (attempt > maxRetries) throw err;
      const delay = 1000 * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

/**
 * (optional) convenience: upload JSON metadata as a Blob
 */
export async function uploadJsonMetadata(obj, opts = {}) {
  const jsonStr = JSON.stringify(obj);
  const blob = new Blob([jsonStr], { type: "application/json" });
  return uploadToNFTStorage(blob, opts);
}
