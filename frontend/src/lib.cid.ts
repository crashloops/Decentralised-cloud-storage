/**
 * Generate a fake CID for UI/testing purposes
 * 
 * WARNING: This is NOT a real IPFS CID (not multiformats validated).
 * It's only for UI/demo purposes. Do NOT use where real CIDs are expected
 * (e.g., gateway redirects, IPFS lookups).
 * 
 * For production, use actual IPFS CIDs from NFT.Storage or other IPFS services.
 */
export async function fakeCidFromBlob(blob: Blob) {
  const buf = await blob.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', buf);
  const hex = [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2,'0')).join('');
  // shorten for UI but keep stable
  return 'bafy' + hex.slice(0, 46);
}
