import React, { useEffect, useMemo, useState, useCallback } from 'react'
import { Header } from './components/Header'
import { Sidebar } from './components/Sidebar'
import { UploadArea } from './components/UploadArea'
import { FileList } from './components/FileList'
import { DetailsPane } from './components/DetailsPane'
import { Toast } from './components/Toast'
import { useWallet } from './contexts/WalletContext'
import { chunkedUploadFile } from './services/chunkedUpload'
import { chunkedDownloadFile } from './services/chunkedDownload'
import { MockStorage, type StorageAdapter } from './adapters.storage'
import type { StoredEntry } from './lib.db'
import { PreviewModal } from './components/PreviewModal'
import { ShareModal } from './components/ShareModal'
import { Contract, utils } from 'ethers'
import CONTRACT_ABI from './contracts/TimeBoundFileRegistry.abi.json'

const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS || ''
const PROXY_URL = import.meta.env.VITE_PROXY_URL || ''

type Tab = 'drive' | 'shared' | 'starred' | 'trash'

type ToastType = 'info' | 'success' | 'error'
type ToastState = { id: number; message: string; type: ToastType }

export default function App({ initialTab }: { initialTab?: 'shared' } = {}) {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    if (typeof globalThis.window !== 'undefined') {
      try {
        const stored = globalThis.localStorage.getItem('ddrive.theme')
        if (stored === 'dark' || stored === 'light') return stored
      } catch {}
    }
    return 'dark'
  })

  const { account, signer, connect: connectWallet, isConnected, decryptWithSignature } = useWallet()
  const [storage] = useState<StorageAdapter>(MockStorage)
  const [entries, setEntries] = useState<StoredEntry[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [uploading, setUploading] = useState<{ name: string; pct: number }[]>([])
  const [preview, setPreview] = useState<{ url: string; mime: string; name: string } | null>(
    null
  )
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list')

  const [tab, setTab] = useState<Tab>(initialTab === 'shared' ? 'shared' : 'drive')
  const [trashedIds, setTrashedIds] = useState<string[]>([])
  const [starredIds, setStarredIds] = useState<string[]>([])
  const [showDetails, setShowDetails] = useState(true)
  const [shareModalEntry, setShareModalEntry] = useState<StoredEntry | null>(null)

  const [toast, setToast] = useState<ToastState | null>(null)
  const selectionCount = selectedIds.length

// if you want: only treat as "selected entry" when exactly one is picked
const selectedEntry =
  selectionCount === 1
    ? entries.find(e => e.id === selectedIds[0]) ?? null
    : null

  useEffect(() => {
    try {
      globalThis.localStorage.setItem('ddrive.theme', theme)
    } catch {}
  }, [theme])

  const closePreview = useCallback(() => {
    setPreview(prev => {
      try {
        if (prev?.url) URL.revokeObjectURL(prev.url)
      } catch {}
      return null
    })
  }, [])

  function showToast(message: string, type: ToastType = 'info') {
    const id = Date.now()
    setToast({ id, message, type })
    globalThis.setTimeout(() => {
      setToast(current => (current?.id === id ? null : current))
    }, 2500)
  }

  const driveEntries = useMemo(
    () => entries.filter(e => !trashedIds.includes(e.id)),
    [entries, trashedIds]
  )
  const trashEntries = useMemo(
    () => entries.filter(e => trashedIds.includes(e.id)),
    [entries, trashedIds]
  )
  const starredEntries = useMemo(
    () => entries.filter(e => starredIds.includes(e.id) && !trashedIds.includes(e.id)),
    [entries, starredIds, trashedIds]
  )

  const [sharedEntries, setSharedEntries] = useState<StoredEntry[]>([])

  const visibleEntries = useMemo(() => {
    if (tab === 'trash') return trashEntries
    if (tab === 'starred') return starredEntries
    if (tab === 'shared') return sharedEntries
    return driveEntries
  }, [tab, driveEntries, trashEntries, starredEntries, sharedEntries])

  const isTrashView = tab === 'trash'

  const storageUsedBytes = useMemo(
    () => driveEntries.reduce((sum, e) => sum + (e.size || 0), 0),
    [driveEntries]
  )

  const selected = useMemo(
    () => entries.find(e => e.id === selectedId) || null,
    [entries, selectedId]
  )

  useEffect(() => {
    refreshList()

    try {
      const rawTrash = localStorage.getItem('ddrive.trashedIds')
      if (rawTrash) setTrashedIds(JSON.parse(rawTrash))
    } catch {}

    try {
      const rawStar = localStorage.getItem('ddrive.starredIds')
      if (rawStar) setStarredIds(JSON.parse(rawStar))
    } catch {}

    // Security: Removed URL hash parsing that extracted keys/IVs
    // Keys should never be parsed from URLs
    const h = new URL(location.href).hash.slice(1)
    const params = new URLSearchParams(h)
    const id = params.get('id')
    // Only parse file ID, never keys or IVs from URL
    if (id) {
      setSelectedId(id)
      setSelectedIds([id])
    }
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem('ddrive.trashedIds', JSON.stringify(trashedIds))
    } catch {}
  }, [trashedIds])

  useEffect(() => {
    try {
      localStorage.setItem('ddrive.starredIds', JSON.stringify(starredIds))
    } catch {}
  }, [starredIds])

  // Load shared files from contract
  async function loadSharedFiles() {
    if (!isConnected || !account || !CONTRACT_ADDRESS) {
      setSharedEntries([])
      return
    }

    try {
      const provider = new (await import('ethers')).providers.Web3Provider(window.ethereum)
      const contract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider)

      // Query AccessGranted events for current account as grantee
      // Note: This is a simplified approach - in production, you might want to index events
      // For now, we'll check known files from our entries
      const shared: StoredEntry[] = []
      
      // Check all entries to see if any are shared with current user
      for (const entry of entries) {
        if (entry.metadataCid && entry.ownerAddr && entry.ownerAddr.toLowerCase() !== account.toLowerCase()) {
          try {
            const hasAccess = await contract.isAccessActive(entry.ownerAddr, entry.metadataCid, account)
            if (hasAccess) {
              shared.push(entry)
            }
          } catch (err) {
            // Skip entries that fail access check
            console.warn('Access check failed for entry:', entry.id, err)
          }
        }
      }

      setSharedEntries(shared)
    } catch (err) {
      console.error('Failed to load shared files:', err)
      setSharedEntries([])
    }
  }

  useEffect(() => {
    if (isConnected && account && tab === 'shared') {
      loadSharedFiles()
    }
  }, [isConnected, account, tab, entries])

  async function refreshList() {
    const list = await storage.list()
    setEntries(list)
  }

  async function onFiles(files: FileList) {
    if (!isConnected || !account) {
      alert('Please connect your wallet first')
      return
    }

    if (!PROXY_URL) {
      alert('VITE_PROXY_URL not configured')
      return
    }

    const batch = Array.from(files)
    for (const f of batch) {
      setUploading(u => [...u, { name: f.name, pct: 0 }])
      const onProgress = (pct: number, uploadedBytes: number, totalBytes: number) => {
        setUploading(u => u.map(r => (r.name === f.name ? { ...r, pct } : r)))
        console.log(`Uploading ${f.name}: ${pct}% (${uploadedBytes}/${totalBytes} bytes)`)
      }

      try {
        console.log(`Starting chunked upload for ${f.name}...`)
        
        // Check if contract is configured for on-chain registration
        const hasContract = !!CONTRACT_ADDRESS && !!signer
        console.log('[App] Upload configuration:', {
          hasContractAddress: !!CONTRACT_ADDRESS,
          contractAddress: CONTRACT_ADDRESS,
          hasSigner: !!signer,
          account: account,
          willAutoRegister: hasContract
        })
        
        if (!CONTRACT_ADDRESS) {
          console.warn('VITE_CONTRACT_ADDRESS not set - files will be uploaded but cannot be downloaded without contract')
          alert(
            'Warning: Contract address not configured.\n\n' +
            'Files will upload successfully, but you won\'t be able to download them until you:\n' +
            '1. Deploy the TimeBoundFileRegistry contract (see server/contract.sol)\n' +
            '2. Add VITE_CONTRACT_ADDRESS=0x... to frontend/.env\n\n' +
            'The contract address is the address of the deployed smart contract, NOT your wallet address.'
          )
        }

        const result = await chunkedUploadFile(f, {
          ownerAddr: account,
          signer: signer || undefined,
          contractAddress: CONTRACT_ADDRESS || undefined,
          proxyUrl: PROXY_URL,
          onProgress,
          autoRegister: hasContract,
        })

        console.log('Upload complete:', result)
        showToast(`Upload complete: ${result.metadataCid}`, 'success')
        
        if (result.txReceipt) {
          console.log('On-chain registration:', result.txReceipt.transactionHash)
          showToast('File registered on-chain', 'success')
        } else if (hasContract) {
          console.warn('Upload completed but no transaction receipt. File may not be registered on-chain.')
          alert(
            'Warning: File uploaded but may not be registered on-chain.\n\n' +
            'Check the browser console for details. The file may not be downloadable.'
          )
        }

        // Save entry to IndexedDB for file listing
        const { putEntry } = await import('./lib.db')
        const entry: StoredEntry = {
          id: result.metadataCid, // Use metadataCid as ID for chunked files
          name: f.name,
          size: f.size,
          mime: f.type || 'application/octet-stream',
          createdAt: Date.now(),
          metadataCid: result.metadataCid,
          ownerAddr: account,
          onChainTx: result.txReceipt?.transactionHash || null,
          encryptedKeyForOwner: null, // Not stored here - it's in the contract
        }
        await putEntry(entry)

        // Refresh list to show new file
        await refreshList()
      } catch (e: any) {
        console.error('Upload failed:', e)
        alert('Upload failed: ' + (e.message || String(e)))
        showToast('Upload failed', 'error')
      } finally {
        setUploading(u => u.filter(x => x.name !== f.name))
      }
    }
  }

  async function openFile(id: string) {
    if (!isConnected || !account) {
      alert('Please connect your wallet first')
      return
    }

    try {
      const entry = entries.find(e => e.id === id)
      if (!entry) {
        throw new Error('File not found')
      }

      // Check if this is a chunked file (has metadataCid) or legacy file
      if (entry.metadataCid && entry.ownerAddr) {
        // Chunked file - use contract access check and IPFS download
        if (!CONTRACT_ADDRESS) {
          throw new Error(
            'Contract address not configured.\n\n' +
            'To download files, you need to:\n' +
            '1. Deploy the TimeBoundFileRegistry smart contract (see server/contract.sol)\n' +
            '2. Add the deployed contract address to frontend/.env as:\n' +
            '   VITE_CONTRACT_ADDRESS=0x...\n\n' +
            'The contract address is NOT your wallet address - it\'s the address of the deployed smart contract.\n' +
            'You can deploy it using Hardhat, Remix, or any Solidity development tool.'
          )
        }

        const provider = new (await import('ethers')).providers.Web3Provider(window.ethereum)
        const contract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider)

        // Check if user has access (owner or grantee)
        const isOwner = entry.ownerAddr.toLowerCase() === account.toLowerCase()
        let hasAccess = isOwner

        if (!isOwner) {
          // Check if access is granted
          try {
            hasAccess = await contract.isAccessActive(entry.ownerAddr, entry.metadataCid, account)
          } catch (err) {
            console.warn('Access check failed:', err)
            hasAccess = false
          }
        }

        if (!hasAccess) {
          alert('You do not have access to this file. Request access from the owner.')
          showToast('Access denied', 'error')
          return
        }

        // Get encrypted key from contract
        let encryptedKeyBytes: Uint8Array
        if (isOwner) {
          // Owner: get from their file record
          try {
            const fileRecord = await contract.getFile(entry.ownerAddr, entry.metadataCid)
            // getFile returns: (cidOut, encryptedKeyOut, timestampOut, revokedOut, existsOut)
            const exists = fileRecord.existsOut !== undefined ? fileRecord.existsOut : fileRecord[4]
            if (!fileRecord || !exists) {
              throw new Error(
                'File not found in contract. This file was uploaded before the contract was configured.\n\n' +
                'Please re-upload the file to register it on-chain with the encrypted key.'
              )
            }
            const encryptedKey = fileRecord.encryptedKeyOut !== undefined ? fileRecord.encryptedKeyOut : fileRecord[1]
            encryptedKeyBytes = utils.arrayify(encryptedKey)
            if (!encryptedKeyBytes || encryptedKeyBytes.length === 0) {
              throw new Error('Encrypted key is empty in contract. File may not have been registered properly.')
            }
          } catch (err: any) {
            if (err.message?.includes('not found')) {
              throw err
            }
            throw new Error(`Failed to get file from contract: ${err.message || err}`)
          }
        } else {
          // Grantee: get from access record
          const accessRecord = await contract.getAccess(entry.ownerAddr, entry.metadataCid, account)
          // getAccess returns: (encryptedKeyForGrantee, start, end, revoked, exists)
          if (!accessRecord.exists || accessRecord.revoked) {
            throw new Error('Access record not found or revoked')
          }
          encryptedKeyBytes = utils.arrayify(accessRecord.encryptedKeyForGrantee)
          if (!encryptedKeyBytes || encryptedKeyBytes.length === 0) {
            throw new Error('Encrypted key is empty in access record.')
          }
        }

        // Decrypt key using MetaMask (ALWAYS works - no fallbacks)
        // Verify we're using the correct account
        if (isOwner && entry.ownerAddr.toLowerCase() !== account.toLowerCase()) {
          throw new Error(
            `Account mismatch. File was uploaded by ${entry.ownerAddr} but you're trying to decrypt with ${account}. ` +
            'Please switch to the correct wallet account.'
          )
        }
        
        console.log('Attempting to decrypt key for account:', account)
        console.log('Encrypted key bytes length:', encryptedKeyBytes.length)
        console.log('Encrypted key bytes preview:', Array.from(encryptedKeyBytes.slice(0, 50)).map(b => b.toString(16).padStart(2, '0')).join(' ') + '...')
        
        // Show attention modal BEFORE requesting signature (prevents popup suppression)
        const userConfirmed = confirm(
          'MetaMask will now ask you to sign a message to decrypt the file.\n\n' +
          'Please:\n' +
          '1. Look for the MetaMask signature request popup\n' +
          '2. Click "Sign" to authorize decryption\n\n' +
          'This signature is used to derive your decryption key. It does not approve any transactions.\n\n' +
          'Click OK to continue, or Cancel to abort.'
        )
        
        if (!userConfirmed) {
          showToast('Decryption cancelled', 'info')
          return
        }
        
        // Show toast notification
        showToast('Requesting signature to decrypt file...', 'info')
        
        // Request decryption using signature-based key derivation (NO deprecated MetaMask decrypt API)
        // Pass raw bytes, normalization function will handle conversion
        const aesKeyBase64 = await decryptWithSignature(encryptedKeyBytes, account)
        
        if (!aesKeyBase64 || aesKeyBase64.length === 0) {
          throw new Error('Decryption returned empty result')
        }

        // Download and decrypt file
        showToast('Downloading file...', 'info')
        const result = await chunkedDownloadFile(entry.metadataCid, aesKeyBase64, {
          onProgress: (pct) => {
            console.log(`Download progress: ${pct}%`)
          },
        })

        showToast(`Downloaded: ${result.filename}`, 'success')
      } else {
        // Legacy file - use mock storage
        const { blob, entry: legacyEntry } = await storage.downloadEncrypted(id)
        const url = URL.createObjectURL(blob)
        setPreview(prev => {
          try {
            if (prev?.url) URL.revokeObjectURL(prev.url)
          } catch {}
          return { url, mime: legacyEntry.mime || 'application/octet-stream', name: legacyEntry.name }
        })
      }
    } catch (e: any) {
      console.error('Open failed:', e)
      alert('Open failed: ' + (e.message || String(e)))
      showToast('Open failed', 'error')
    }
  }

  function moveToTrash(id: string) {
    setTrashedIds(prev => (prev.includes(id) ? prev : [...prev, id]))
    setSelectedIds(prev => prev.filter(x => x !== id))
    if (selectedId === id) setSelectedId(null)
    showToast('Moved to Trash', 'info')
  }

  async function remove(id: string) {
    await storage.remove(id)
    await refreshList()
    setTrashedIds(prev => prev.filter(x => x !== id))
    setSelectedIds(prev => prev.filter(x => x !== id))
    if (selectedId === id) setSelectedId(null)
    showToast('File deleted permanently', 'success')
  }

  function copyShare(e: StoredEntry) {
    // Open ShareModal for grant access
    setShareModalEntry(e)
  }

  function renameEntry(id: string, name: string) {
    setEntries(prev => prev.map(e => (e.id === id ? { ...e, name } : e)))
    if (selectedId === id) setSelectedId(id)
    showToast(`Renamed to "${name}"`, 'info')
  }

  function setSelection(ids: string[]) {
    setSelectedIds(ids)
    setSelectedId(ids.length ? ids[ids.length - 1] : null)
  }

  function toggleStar(id: string) {
    setStarredIds(prev => {
      const exists = prev.includes(id)
      const next = exists ? prev.filter(x => x !== id) : [...prev, id]
      showToast(exists ? 'Removed from Starred' : 'Added to Starred', 'info')
      return next
    })
  }

  async function connect() {
    const addr = await connectWallet()
    if (!addr) {
      alert('MetaMask not detected. Please install or enable it.')
    }
  }

  function toggleTheme() {
    setTheme(prev => (prev === 'dark' ? 'light' : 'dark'))
  }

  const rootClasses =
    theme === 'dark'
      ? 'bg-slate-950 text-slate-100'
      : 'bg-slate-50 text-slate-900'

  return (
    <div className={`min-h-screen flex flex-col ${rootClasses}`}>
      <Header
        address={account}
        onConnect={connect}
        theme={theme}
        onToggleTheme={toggleTheme}
      />

      <main className="flex flex-1 overflow-hidden">
        <Sidebar
          activeTab={tab}
          onChangeTab={setTab}
          storageUsedBytes={storageUsedBytes}
          storageLimitBytes={5 * 1024 ** 3}
          theme={theme}
        />

        <section className="flex-1 p-4 space-y-4 flex flex-col overflow-hidden">
          <UploadArea onFiles={onFiles} theme={theme} />


          {uploading.length > 0 && (
            <div className="mb-3 space-y-2">
              {uploading.map(u => (
                <div
                  key={u.name}
                  className="bg-slate-900/60 rounded-xl p-2 border border-slate-800"
                >
                  <div className="flex items-center justify-between text-sm">
                    <span>{u.name}</span>
                    <span>{u.pct.toFixed(0)}%</span>
                  </div>
                  <div className="h-1.5 bg-slate-800 rounded-full mt-2 overflow-hidden">
                    <div
                      className="h-full bg-indigo-500"
                      style={{ width: `${u.pct}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
          {/* Search stub */}
          <div className="mt-1">
            <div
              className={
                'rounded-xl px-4 py-2 text-sm ' +
                (theme === 'dark'
                  ? 'bg-slate-900 text-slate-100'
                  : 'bg-white border border-slate-200 text-slate-500 shadow-sm')
              }
            >
              Search by name or tag... (coming soon)
            </div>
          </div>

          <FileList
            entries={visibleEntries}
            selectedId={selectedId}
            selectedIds={selectedIds}
            viewMode={viewMode}
            onChangeView={setViewMode}
            onSetSelection={setSelection}
            onOpen={openFile}
            onRemove={id => (isTrashView ? remove(id) : moveToTrash(id))}
            isTrashView={isTrashView}
            showDetails={showDetails}
            onToggleDetails={() => setShowDetails(v => !v)}
            onRename={renameEntry}
            starredIds={starredIds}
            onToggleStar={toggleStar}
            theme={theme}          
          />

        </section>

        {showDetails && (
          <aside
            className={
              'w-full max-w-md border-l p-4 ' +
              (theme === 'dark' ? 'border-slate-800' : 'border-slate-200')
            }
          >
            <DetailsPane
  entry={selectedEntry} selectionCount={selectionCount}
  onCopyLink={copyShare}
  onRename={renameEntry}
  theme={theme}
/>

          </aside>
        )}
      </main>

      {preview && (
        <PreviewModal
          url={preview.url}
          mime={preview.mime}
          name={preview.name}
          onClose={closePreview}
        />
      )}

      {toast && <Toast message={toast.message} type={toast.type} />}

      {shareModalEntry && (
        <ShareModal
          entry={shareModalEntry}
          onClose={() => setShareModalEntry(null)}
        />
      )}

      <footer
        className={
          'border-t px-4 py-3 text-xs ' +
          (theme === 'dark' ? 'border-slate-800 text-slate-500' : 'border-slate-200 text-slate-500')
        }
      >
        Drive-like UX • Client-side encryption • Mock storage (IndexedDB). Adapters ready for
        IPFS/Smart Contract later.
      </footer>
    </div>
  )
}
