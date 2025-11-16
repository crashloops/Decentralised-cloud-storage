import React, { useState } from 'react'
import type { StoredEntry } from '../lib.db'
import { useWallet } from '../contexts/WalletContext'
import { Contract, utils } from 'ethers'
import CONTRACT_ABI from '../contracts/TimeBoundFileRegistry.abi.json'

const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS || ''

export function ShareModal({ entry, onClose }:{ entry: StoredEntry, onClose: ()=>void }){
  const { account, signer, decryptWithSignature, deriveEncryptionKeypair } = useWallet()
  const [granteeAddr, setGranteeAddr] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [granting, setGranting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const url = makeShareUrl(entry)
  const isChunkedFile = !!(entry.metadataCid && entry.ownerAddr)

  async function handleGrantAccess() {
    if (!isChunkedFile) {
      alert('Grant access is only available for files stored on IPFS')
      return
    }

    if (!account || !signer) {
      alert('Please connect your wallet first')
      return
    }

    if (!CONTRACT_ADDRESS) {
      alert('Contract address not configured')
      return
    }

    if (!granteeAddr || !granteeAddr.match(/^0x[a-fA-F0-9]{40}$/)) {
      setError('Invalid Ethereum address')
      return
    }

    if (!startTime || !endTime) {
      setError('Please set start and end times')
      return
    }

    const start = Math.floor(new Date(startTime).getTime() / 1000)
    const end = Math.floor(new Date(endTime).getTime() / 1000)

    if (end <= start) {
      setError('End time must be after start time')
      return
    }

    if (end <= Date.now() / 1000) {
      setError('End time must be in the future')
      return
    }

    setGranting(true)
    setError(null)

    try {
      const contract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer)

      // Get the grantee's encryption public key using signature-based derivation
      // Note: For sharing, the grantee needs to sign first to derive their key
      // This is a simplified approach - in production, you'd have a flow where grantee signs first
      // For now, we'll show an error explaining this limitation
      throw new Error(
        'File sharing with signature-based encryption requires the grantee to sign a message first. ' +
        'This feature will be enhanced in a future update. ' +
        'Currently, files can only be decrypted by the owner who uploaded them.'
      )
      
      // TODO: Implement proper grantee signature flow:
      // 1. Request grantee to connect wallet and sign message
      // 2. Derive grantee's encryption keypair from signature
      // 3. Encrypt owner's AES key to grantee's public key
      // 4. Store on-chain
      
      // Example future implementation:
      // const granteeProvider = new ethers.providers.Web3Provider(window.ethereum)
      // const granteeSigner = granteeProvider.getSigner(granteeAddr)
      // const { publicKeyBase64: granteePublicKey } = await requestEncryptionKeypair(granteeSigner, granteeAddr)

      // Get owner's encrypted key from contract
      const fileRecord = await contract.getFile(entry.ownerAddr!, entry.metadataCid!)
      const encryptedKeyBytes = utils.arrayify(fileRecord.encryptedKeyOut)

      // Decrypt owner's key using signature-based key derivation (NO deprecated MetaMask decrypt API)
      const aesKeyBase64 = await decryptWithSignature(encryptedKeyBytes, account)
      
      if (!aesKeyBase64 || aesKeyBase64.length === 0) {
        throw new Error('Decryption returned empty result')
      }

      // Encrypt key for grantee using pure browser crypto
      const { encryptForMetaMask } = await import('../utils/encryption')
      const encryptedForGrantee = encryptForMetaMask(granteePublicKey, aesKeyBase64)
      
      // Defensive check before encoding
      if (!encryptedForGrantee || typeof encryptedForGrantee !== 'object') {
        throw new Error('Failed to encrypt key for grantee: encryption returned invalid result')
      }
      
      const encryptedStr = JSON.stringify(encryptedForGrantee)
      if (!encryptedStr || typeof encryptedStr !== 'string' || !encryptedStr.length) {
        throw new Error('Failed to create encrypted key string for grantee')
      }
      
      const encryptedBytes = new TextEncoder().encode(encryptedStr)

      // Grant access on-chain
      const tx = await contract.grantAccess(
        granteeAddr,
        entry.metadataCid!,
        encryptedBytes,
        start,
        end
      )

      await tx.wait(1)

      alert(`Access granted to ${granteeAddr}`)
      onClose()
    } catch (err: any) {
      console.error('Grant access failed:', err)
      setError(err.message || 'Failed to grant access')
    } finally {
      setGranting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 grid place-items-center p-4 z-50">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl p-4 w-full max-w-xl max-h-[90vh] overflow-y-auto">
        <div className="text-lg font-semibold mb-2">Share / Grant Access</div>
        
        {isChunkedFile ? (
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-slate-300 mb-1">Grantee Address</label>
              <input
                type="text"
                value={granteeAddr}
                onChange={(e) => setGranteeAddr(e.target.value)}
                placeholder="0x..."
                className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2 text-slate-200 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-300 mb-1">Start Time</label>
              <input
                type="datetime-local"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2 text-slate-200 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-300 mb-1">End Time</label>
              <input
                type="datetime-local"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl p-2 text-slate-200 text-sm"
              />
            </div>
            {error && (
              <div className="text-red-400 text-sm">{error}</div>
            )}
            <div className="flex gap-2 justify-end">
              <button
                className="rounded-xl bg-slate-800 px-4 py-2 text-sm hover:bg-slate-700 disabled:opacity-50"
                onClick={onClose}
                disabled={granting}
              >
                Cancel
              </button>
              <button
                className="rounded-xl bg-indigo-500 px-4 py-2 text-sm hover:bg-indigo-400 disabled:opacity-50"
                onClick={handleGrantAccess}
                disabled={granting || !granteeAddr || !startTime || !endTime}
              >
                {granting ? 'Granting...' : 'Grant Access'}
              </button>
            </div>
          </div>
        ) : (
          <div>
            <p className="text-sm text-slate-400 mb-3">This link contains only the file ID. Access control and key management must be handled securely through the backend.</p>
            <textarea readOnly className="w-full h-28 bg-slate-950 border border-slate-700 rounded-xl p-2 text-slate-200 text-sm" value={url} />
            <div className="mt-3 flex gap-2 justify-end">
              <button className="rounded-xl bg-slate-800 px-3 py-1.5 text-sm hover:bg-slate-700" onClick={()=>navigator.clipboard.writeText(url)}>Copy</button>
              <button className="rounded-xl bg-indigo-500 px-3 py-1.5 text-sm hover:bg-indigo-400" onClick={onClose}>Close</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function makeShareUrl(e: StoredEntry){
  // Security: Keys and IVs are never included in share URLs
  // Only file ID is included - access control should be handled server-side
  const u = new URL(location.href)
  u.hash = `id=${encodeURIComponent(e.id)}`
  return u.toString()
}
