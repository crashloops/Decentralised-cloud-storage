/**
 * Storage adapter interface and implementations
 * 
 * SECURITY: This adapter uses secure StoredEntry type that does NOT persist raw keys.
 * Only encryptedKeyForOwner (owner-encrypted JSON) is stored.
 */

import { putEntry, putBlob, listEntries, getBlob, getEntry, removeEntry, StoredEntry } from "./lib.db";
import { fakeCidFromBlob } from "./lib.cid";

export interface StorageAdapter {
  uploadEncrypted(file: File): { entry: any; } | PromiseLike<{ entry: any; }>;
  // SECURITY: Updated to use encryptedKeyForOwner instead of raw keys
  upload: (
    blob: Blob,
    meta: {
      name: string;
      size: number;
      mime: string;
      ivB64: string;
      encryptedKeyForOwner?: string | null; // Owner-encrypted key JSON (not raw key)
    },
    onProgress?: (p: number) => void
  ) => Promise<string>; // returns id
  downloadEncrypted: (id: string) => Promise<{ blob: Blob; entry: StoredEntry }>;
  list: () => Promise<StoredEntry[]>;
  remove: (id: string) => Promise<void>;
}

export const MockStorage: StorageAdapter = {
  async upload(blob, meta, onProgress) {
    // Simulate progress
    const total = blob.size || 1;
    let sent = 0;
    await new Promise<void>((resolve) => {
      const id = setInterval(() => {
        sent += Math.max(1, Math.floor(total / 20));
        onProgress?.(Math.min(95, (sent / total) * 100));
        if (sent >= total) {
          clearInterval(id);
          resolve();
        }
      }, 60);
    });
    const id = await fakeCidFromBlob(blob);
    
    // SECURITY: Only store encryptedKeyForOwner, never raw keys
    const entry: StoredEntry = {
      id,
      name: meta.name,
      size: meta.size,
      mime: meta.mime,
      createdAt: Date.now(),
      encryptedKeyForOwner: meta.encryptedKeyForOwner || null,
      // Note: ivB64 is not stored in StoredEntry anymore
      // IVs are typically packed with the encrypted blob or stored separately if needed
    };
    
    await putBlob(id, blob);
    await putEntry(entry);
    onProgress?.(100);
    return id;
  },
  async downloadEncrypted(id: string) {
    const blob = await getBlob(id);
    const entry = await getEntry(id);
    if (!blob || !entry) throw new Error('Not found');
    return { blob, entry };
  },
  list: async () => listEntries(),
  remove: async (id: string) => removeEntry(id),
  uploadEncrypted: function (file: File): { entry: any; } | PromiseLike<{ entry: any; }> {
    throw new Error("Function not implemented.");
  },
};
