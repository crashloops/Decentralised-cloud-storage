// src/components/Downloader/Downloader.js
import React, { useState } from "react";
import { Contract, utils } from "ethers";
import { useWallet } from "../../contexts/WalletContext"; // optional - expected
import CONTRACT_ABI from "../../contracts/TimeBoundFileRegistry.abi.json";
import { importKeyFromBase64, decryptArrayBuffer } from "../../services/cryptoService";
import { fetchBlobFromGateway } from "../../services/nftService";

// Read contract address from env
const CONTRACT_ADDRESS = import.meta?.env?.VITE_CONTRACT_ADDRESS || process.env.REACT_APP_CONTRACT_ADDRESS;

export default function Downloader() {
  const { account, ethDecrypt } = useWallet ? useWallet() : { account: null, ethDecrypt: null };
  const [ownerAddr, setOwnerAddr] = useState("");
  const [cid, setCid] = useState("");
  const [status, setStatus] = useState("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);

  // Utility: decode on-chain bytes (bytes / hex / Uint8Array) to JSON string that MetaMask expects
  function decodeEncryptedKeyFromContract(raw) {
    // ethers often returns hex string (0x...) or Uint8Array (arrayify)
    if (!raw) return null;
    try {
      if (typeof raw === "string") {
        // strip 0x if present and decode to bytes
        const hex = raw.startsWith("0x") ? raw : "0x" + raw;
        const bytes = utils.arrayify(hex);
        return new TextDecoder().decode(bytes);
      } else if (raw instanceof Uint8Array || Array.isArray(raw)) {
        const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
        return new TextDecoder().decode(bytes);
      } else if (raw._isBuffer) {
        // sometimes Buffer is returned
        return new TextDecoder().decode(Uint8Array.from(raw));
      } else {
        // fallback: try toString
        return String(raw);
      }
    } catch (e) {
      return null;
    }
  }

  async function whenUserDecrypts(ciphertextJson) {
    // prefer WalletContext ethDecrypt if available, else call window.ethereum
    if (ethDecrypt && typeof ethDecrypt === "function") {
      // our WalletContext.ethDecrypt should already call eth_decrypt and return the plaintext string
      return ethDecrypt(ciphertextJson, account);
    }
    if (!window.ethereum) throw new Error("No Ethereum provider (MetaMask) found for decryption.");
    // MetaMask expects the ciphertext JSON string as-is and the account
    return window.ethereum.request({
      method: "eth_decrypt",
      params: [ciphertextJson, account]
    });
  }

  async function handleDownloadClick() {
    setError(null);
    setProgress(0);
    setStatus("starting");

    if (!CONTRACT_ADDRESS) {
      setError("Contract address not configured.");
      setStatus("idle");
      return;
    }
    if (!window.ethereum && (!account)) {
      setError("Connect MetaMask / wallet first.");
      setStatus("idle");
      return;
    }
    if (!ownerAddr || !cid) {
      setError("Owner address and CID are required.");
      setStatus("idle");
      return;
    }

    try {
      setStatus("checking-access");

      // Minimal provider via window.ethereum with ethers if needed
      const provider = new (await import("ethers")).providers.Web3Provider(window.ethereum);
      const contract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);

      // 1) Check active access
      const isActive = await contract.isAccessActive(ownerAddr, cid, account);
      if (!isActive) {
        throw new Error("Access inactive, expired or revoked.");
      }

      setStatus("fetching-access-record");

      // 2) getAccess(owner, cid, account) -> returns (bytes encryptedKeyForGrantee, start, end, revoked, exists)
      const accessTuple = await contract.getAccess(ownerAddr, cid, account);
      const encryptedKeyOnChain = accessTuple[0];
      const exists = accessTuple[4];
      const revoked = accessTuple[3];

      if (!exists || revoked) {
        throw new Error("Access not found or revoked.");
      }

      // 3) decode bytes -> ciphertext JSON string (MetaMask format)
      const ciphertextJson = decodeEncryptedKeyFromContract(encryptedKeyOnChain);
      if (!ciphertextJson) throw new Error("Failed to decode encrypted key from contract.");

      setStatus("requesting-decryption");
      // 4) ask MetaMask to decrypt this encrypted AES key
      // -> returns base64 AES key (the frontend must have stored it this way at upload)
      const aesKeyBase64 = await whenUserDecrypts(ciphertextJson); // MetaMask will show prompt to user

      if (!aesKeyBase64) throw new Error("Decryption aborted or failed.");

      setStatus("importing-key");
      // 5) import AES key into Web Crypto
      const aesCryptoKey = await importKeyFromBase64(aesKeyBase64); // function must import as AES-GCM key

      setStatus("downloading-encrypted");
      setProgress(0);

      // 6) fetch encrypted blob from gateway (streaming)
      const arrayBuffer = await fetchBlobFromGateway(cid, {
        onProgress: (p) => {
          if (typeof p === "number") setProgress(p);
        },
        timeoutMs: 5 * 60 * 1000
      });

      setStatus("decrypting");
      // 7) unpack iv + ciphertext
      const full = new Uint8Array(arrayBuffer);
      if (full.length < 13) throw new Error("Downloaded data too small / corrupted.");

      const iv = full.slice(0, 12); // 12 bytes IV
      const ciphertext = full.slice(12).buffer;

      // 8) decrypt ciphertext with AES-GCM key
      const plainArrayBuffer = await decryptArrayBuffer(aesCryptoKey, iv, ciphertext);

      if (!plainArrayBuffer) throw new Error("Decryption failed or returned empty.");

      // 9) build Blob and trigger download
      setStatus("saving");
      const blob = new Blob([plainArrayBuffer], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const filename = `file_${cid}.bin`; // if you have metadata with filename, use it instead
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // revoke later
      setTimeout(() => URL.revokeObjectURL(url), 60 * 1000);

      setStatus("done");
      setProgress(100);
    } catch (err) {
      console.error("Download error (only high-level info):", err.message || err);
      // Do not log sensitive data (AES keys, ciphertexts) anywhere
      setError(err.message || String(err));
      setStatus("error");
    }
  }

  return (
    <div style={{ maxWidth: 800, margin: "1rem auto", padding: 12 }}>
      <h3>Download & Decrypt</h3>

      <div style={{ marginBottom: 8 }}>
        <label>Owner address</label><br />
        <input value={ownerAddr} onChange={(e) => setOwnerAddr(e.target.value)} placeholder="0x..." style={{ width: "100%" }} />
      </div>

      <div style={{ marginBottom: 8 }}>
        <label>CID</label><br />
        <input value={cid} onChange={(e) => setCid(e.target.value)} placeholder="bafy..." style={{ width: "100%" }} />
      </div>

      <div style={{ marginTop: 12 }}>
        <button onClick={handleDownloadClick} style={{ padding: "8px 12px" }}>
          Fetch & Decrypt
        </button>
      </div>

      <div style={{ marginTop: 12 }}>
        <div>Status: <strong>{status}</strong></div>
        <div>Progress: {progress}%</div>
        {error && <div style={{ color: "red", marginTop: 8 }}>Error: {error}</div>}
      </div>
    </div>
  );
}
