/**
 * Chunked file download service
 * Handles downloading chunks from IPFS, decrypting, and reassembling files
 */

import { importKeyFromBase64, decryptChunk } from "./cryptoService";
import { fetchFromIPFSGateway } from "../utils/ipfsGateway";

/**
 * Validate CID format to prevent injection attacks
 * @deprecated Use fetchFromIPFSGateway which includes sanitization
 */
function validateCID(cid: string): boolean {
  // Basic CID validation: should start with 'b' (base32) or 'Qm' (base58)
  // and contain only alphanumeric characters
  return /^[bBQm][a-zA-Z0-9]+$/.test(cid);
}

interface DownloadOptions {
  onProgress?: (percent: number) => void;
  useFileSystemHandle?: boolean;
}

interface ChunkMetadata {
  index: number;
  cid: string;
  size: number;
}

interface FileMetadata {
  type: string;
  filename: string;
  mimeType: string;
  fileSize: number;
  chunkSize: number;
  totalChunks: number;
  chunks: ChunkMetadata[];
  uploader: string;
  uploadedAt: number;
}

/**
 * Download and decrypt chunked file
 */
/**
 * Download and decrypt chunked file
 * 
 * SECURITY: aesKeyBase64 must come from a user-driven eth_decrypt call.
 * Never pass a key that was persisted to storage. Keys should be in-memory only.
 */
export async function chunkedDownloadFile(
  metadataCid: string,
  aesKeyBase64: string,
  opts: DownloadOptions = {}
): Promise<{ success: boolean; filename: string }> {
  const { onProgress } = opts;

  // Validate inputs
  if (!metadataCid || !validateCID(metadataCid)) {
    throw new Error("Invalid metadata CID format");
  }
  if (!aesKeyBase64 || typeof aesKeyBase64 !== "string") {
    throw new Error("Invalid AES key: must be a base64 string");
  }

  // 1. Fetch metadata JSON using robust gateway fetcher
  const { blob: metadataBlob, url: metadataUrl } = await fetchFromIPFSGateway(metadataCid);
  console.log('[Download] Fetched metadata from:', metadataUrl);
  const metadataText = await metadataBlob.text();
  let metadata: FileMetadata;
  try {
    metadata = JSON.parse(metadataText);
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

  // 2. Import AES key
  const aesKey = await importKeyFromBase64(aesKeyBase64);

  // 3. Download and decrypt chunks
  const decryptedChunks: ArrayBuffer[] = [];
  const totalChunks = metadata.chunks.length;

  for (let i = 0; i < totalChunks; i++) {
    const chunkMeta = metadata.chunks[i];
    if (!chunkMeta) {
      throw new Error(`Missing chunk metadata at index ${i}`);
    }
    if (chunkMeta.index !== i) {
      throw new Error(`Chunk index mismatch: expected ${i}, got ${chunkMeta.index}`);
    }
    if (!chunkMeta.cid || !validateCID(chunkMeta.cid)) {
      throw new Error(`Invalid chunk CID at index ${i}: ${chunkMeta.cid}`);
    }

    // Fetch encrypted chunk using robust gateway fetcher
    console.log(`[Download] Fetching chunk ${i + 1}/${totalChunks} (CID: ${chunkMeta.cid})`);
    const { blob: encryptedBlob, url: chunkUrl } = await fetchFromIPFSGateway(chunkMeta.cid);
    console.log(`[Download] Fetched chunk ${i + 1} from:`, chunkUrl);
    const encryptedArrayBuffer = await encryptedBlob.arrayBuffer();

    // Decrypt chunk
    const decrypted = await decryptChunk(aesKey, encryptedArrayBuffer, i);
    decryptedChunks.push(decrypted);

    // Report progress
    if (onProgress) {
      const percent = Math.round(((i + 1) / totalChunks) * 100);
      onProgress(percent);
    }
  }

  // 4. Reassemble file
  const totalSize = decryptedChunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const combined = new Uint8Array(totalSize);
  let offset = 0;
  for (const chunk of decryptedChunks) {
    combined.set(new Uint8Array(chunk), offset);
    offset += chunk.byteLength;
  }

  // 5. Create download
  const blob = new Blob([combined.buffer], { type: metadata.mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = metadata.filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  return { success: true, filename: metadata.filename };
}

