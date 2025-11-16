// src/components/ChunkedDownloader/ChunkedDownloader.js
import React, { useState } from "react";
import { Contract, utils } from "ethers";
import { chunkedDownloadFile } from "../../services/chunkedService";
import { useWallet } from "../../contexts/WalletContext";
import CONTRACT_ABI from "../../contracts/TimeBoundFileRegistry.abi.json";

const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS || process.env.REACT_APP_CONTRACT_ADDRESS;

// Helper to validate Ethereum address format
function isValidAddress(address) {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

// Helper to validate CID format
function isValidCID(cid) {
  return /^[bBQm][a-zA-Z0-9]+$/.test(cid);
}

export default function ChunkedDownloader() {
  // SECURITY: Always call useWallet unconditionally (React Hook rules)
  // Create safe fallback if hook is not available
  let wallet;
  try {
    wallet = useWallet();
  } catch (err) {
    // Hook not available (not wrapped in provider) - use safe fallback
    wallet = { account: null, ethDecrypt: null };
  }
  const { account, ethDecrypt } = wallet;
  
  const [owner, setOwner] = useState("");
  const [metadataCid, setMetadataCid] = useState("");
  const [status, setStatus] = useState("idle");
  const [progress, setProgress] = useState(0);

  async function handleDownload() {
    setStatus("starting");
    if (!owner || !metadataCid) {
      alert("owner and metadataCid required");
      return;
    }
    if (!account) {
      alert("connect wallet");
      return;
    }

    // Validate inputs
    if (!isValidAddress(owner)) {
      alert("Invalid owner address format");
      setStatus("error");
      return;
    }
    if (!isValidCID(metadataCid)) {
      alert("Invalid metadata CID format");
      setStatus("error");
      return;
    }

    try {
      setStatus("checking-access");
      const provider = new (await import("ethers")).providers.Web3Provider(window.ethereum);
      const contract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);
      const active = await contract.isAccessActive(owner, metadataCid, account);
      if (!active) throw new Error("Access inactive");

      const access = await contract.getAccess(owner, metadataCid, account);
      const encryptedOnChain = access[0];
      // decode encrypted bytes to JSON string
      let cipherJson;
      if (typeof encryptedOnChain === "string") {
        const hex = encryptedOnChain.startsWith("0x") ? encryptedOnChain : "0x" + encryptedOnChain;
        const bytes = utils.arrayify(hex);
        cipherJson = new TextDecoder().decode(bytes);
      } else if (encryptedOnChain instanceof Uint8Array || Array.isArray(encryptedOnChain)) {
        const bytes = encryptedOnChain instanceof Uint8Array ? encryptedOnChain : new Uint8Array(encryptedOnChain);
        cipherJson = new TextDecoder().decode(bytes);
      } else {
        cipherJson = String(encryptedOnChain);
      }

      setStatus("decrypting-key");
      // ask MetaMask to decrypt the AES key with proper error handling
      let aesKeyBase64;
      try {
        if (ethDecrypt && typeof ethDecrypt === "function") {
          aesKeyBase64 = await ethDecrypt(cipherJson, account);
        } else if (window.ethereum && window.ethereum.request) {
          aesKeyBase64 = await window.ethereum.request({ 
            method: "eth_decrypt", 
            params: [cipherJson, account] 
          });
        } else {
          throw new Error("MetaMask not available");
        }
      } catch (err) {
        if (err?.code === 4001) {
          // User rejected decryption
          alert("Decryption cancelled by user");
          setStatus("idle");
          return;
        }
        throw new Error("Decryption failed: " + (err.message || err));
      }

      setStatus("downloading");
      await chunkedDownloadFile(metadataCid, aesKeyBase64, {
        onProgress: (pct) => setProgress(pct)
      });

      setStatus("done");
      setProgress(100);
    } catch (err) {
      console.error(err);
      setStatus("error");
      alert("Download failed: " + (err.message || err));
    }
  }

  return (
    <div style={{ maxWidth: 800, margin: "1rem auto", padding: 12 }}>
      <h3>Chunked Downloader</h3>
      <div>
        <label>Owner address</label><br />
        <input value={owner} onChange={(e) => setOwner(e.target.value)} style={{ width: "100%" }} />
      </div>
      <div style={{ marginTop: 8 }}>
        <label>Metadata CID</label><br />
        <input value={metadataCid} onChange={(e) => setMetadataCid(e.target.value)} style={{ width: "100%" }} />
      </div>
      <div style={{ marginTop: 12 }}>
        <button onClick={handleDownload}>Fetch & Decrypt (Chunked)</button>
      </div>
      <div style={{ marginTop: 12 }}>
        <div>Status: {status}</div>
        <div>Progress: {progress}%</div>
      </div>
    </div>
  );
}
