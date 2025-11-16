/**
 * Secure IndexedDB helpers for file storage
 * 
 * SECURITY: Raw AES keys and IVs are NEVER persisted to IndexedDB.
 * Only owner-encrypted key blobs (encryptedKeyForOwner) are stored.
 * This prevents XSS attacks from stealing encryption keys.
 */

import { set, get, del, keys } from 'idb-keyval'

export type StoredEntry = {
  id: string
  name: string
  size: number
  mime: string
  createdAt: number
  // Only owner-encrypted AES key JSON (x25519-xsalsa20-poly1305)
  // This requires eth_decrypt to retrieve the raw key
  encryptedKeyForOwner?: string | null
  // For chunked files stored on IPFS:
  metadataCid?: string | null // IPFS CID of metadata JSON (for chunked files)
  ownerAddr?: string | null // Owner's Ethereum address (for chunked files)
  onChainTx?: string | null // Transaction hash if registered on-chain
  // Note: encrypted file blob is stored separately under 'blob:<id>' (legacy files only)
  // For chunked files, blob is not stored locally - it's on IPFS
}

/**
 * Store entry - automatically strips any legacy raw key/IV fields
 */
export async function putEntry(e: StoredEntry) {
  const clean = { ...e }
  // Ensure no raw key/iv are accidentally persisted
  // Remove legacy fields if present (defensive)
  if ((clean as any).keyB64) delete (clean as any).keyB64
  if ((clean as any).ivB64) delete (clean as any).ivB64
  await set('entry:'+e.id, clean)
}

/**
 * Get entry - automatically sanitizes legacy entries with raw keys
 */
export async function getEntry(id: string): Promise<StoredEntry | undefined> {
  const maybe = await get<StoredEntry>('entry:'+id)
  if (!maybe) return undefined
  
  // If legacy raw fields exist, sanitize them
  if ((maybe as any)?.keyB64 || (maybe as any)?.ivB64) {
    const sanitized = { ...maybe } as any
    delete sanitized.keyB64
    delete sanitized.ivB64
    // Persist sanitized back so we don't keep leaking
    await set('entry:'+id, sanitized)
    return sanitized as StoredEntry
  }
  
  return maybe
}

export async function removeEntry(id: string) {
  await del('entry:'+id)
  await del('blob:'+id)
}

/**
 * Store encrypted blob
 * SECURITY: Blob must already be encrypted before calling this
 */
export async function putBlob(id: string, blob: Blob) {
  await set('blob:'+id, blob)
}

export async function getBlob(id: string) {
  return get<Blob>('blob:'+id)
}

/**
 * List all entries - automatically sanitizes any legacy entries
 */
export async function listEntries(): Promise<StoredEntry[]> {
  const ks = await keys()
  const out: StoredEntry[] = []
  for (const k of ks) {
    if (typeof k === 'string' && k.startsWith('entry:')) {
      const e = await get<StoredEntry>(k)
      if (e) {
        // Sanitize legacy entries
        if ((e as any).keyB64 || (e as any).ivB64) {
          const sanitized = { ...e } as any
          delete sanitized.keyB64
          delete sanitized.ivB64
          await set(k, sanitized)
          out.push(sanitized as StoredEntry)
        } else {
          out.push(e)
        }
      }
    }
  }
  // newest first
  out.sort((a,b)=> b.createdAt - a.createdAt)
  return out
}
