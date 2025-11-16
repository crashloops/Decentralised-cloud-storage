// src/components/FileUploader/FileUploader.js
import React, { useState, useEffect } from "react";
import detectEthereumProvider from "@metamask/detect-provider";
import { BrowserProvider, Contract } from "ethers";
import { encrypt as mmEncrypt } from "@metamask/eth-sig-util"; // ensure bundler handles this
import { generateAESKey, exportKeyToBase64, encryptFileWithAES, packEncryptedBlob } from "../../services/cryptoService";
import { uploadToNFTStorage } from "../../services/nftService";
import CONTRACT_ABI from "../../contracts/TimeBoundFileRegistry.abi.json"; // make sure you have ABI JSON
// Read contract address & nft token from env (Vite uses VITE_ prefixed env vars)
const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS || process.env.REACT_APP_CONTRACT_ADDRESS;
const NFT_STORAGE_TOKEN = import.meta.env.VITE_NFT_STORAGE_TOKEN || process.env.REACT_APP_NFT_STORAGE_TOKEN;

export default function FileUploader() {
  const [account, setAccount] = useState(null);
  const [provider, setProvider] = useState(null);
  const [status, setStatus] = useState("idle");
  const [progressText, setProgressText] = useState("");
  const [lastCid, setLastCid] = useState(null);

  useEffect(() => {
    (async () => {
      const p = await detectEthereumProvider();
      if (p) {
        const bp = new BrowserProvider(window.ethereum);
        setProvider(bp);
        try {
          const accounts = await window.ethereum.request({ method: "eth_accounts" });
          if (accounts && accounts[0]) setAccount(accounts[0]);
        } catch (err) {
          console.warn("eth_accounts failed", err);
        }
      }
    })();
  }, []);

  async function connectWallet() {
    try {
      await window.ethereum.request({ method: "eth_requestAccounts" });
      const bp = new BrowserProvider(window.ethereum);
      setProvider(bp);
      const signer = await bp.getSigner();
      const addr = await signer.getAddress();
      setAccount(addr);
    } catch (err) {
      console.error("Wallet connect failed", err);
      alert("Please install/enable MetaMask and authorize connection.");
    }
  }

  async function handleFile(file) {
    if (!provider) {
      alert("No Ethereum provider found. Please install MetaMask.");
      return;
    }
    if (!account) {
      await connectWallet();
    }

    setStatus("generating-key");
    setProgressText("Generating AES key in browser");
    try {
      // 1. Generate AES key
      const aesKey = await generateAESKey();

      // 2. Encrypt file
      setStatus("encrypting-file");
      setProgressText("Encrypting file locally (AES-GCM)");
      const { ciphertext, iv, mimeType } = await encryptFileWithAES(aesKey, file);

      // 3. Pack iv+ciphertext into a blob
      const blobToUpload = packEncryptedBlob(ciphertext, iv, mimeType || "application/octet-stream");

      // 4. Upload to nft.storage
      setStatus("uploading-ipfs");
      setProgressText("Uploading encrypted file to nft.storage (no per-file progress available)");
      const cid = await uploadToNFTStorage(blobToUpload, { token: NFT_STORAGE_TOKEN });
      setLastCid(cid);
      setStatus("cid-received");
      setProgressText(`CID: ${cid}`);

      // 5. Export AES key raw -> base64
      setStatus("exporting-key");
      setProgressText("Exporting AES key and encrypting with MetaMask public key");
      const rawKeyBase64 = await exportKeyToBase64(aesKey);

      // 6. Get encryption public key from MetaMask for current account
      // NOTE: eth_getEncryptionPublicKey only returns the public key for the selected account in MetaMask
      const publicKey = await window.ethereum.request({
        method: "eth_getEncryptionPublicKey",
        params: [account]
      });

      // 7. Encrypt the AES key using eth-sig-util format
      const encrypted = mmEncrypt({
        publicKey: publicKey,
        data: rawKeyBase64,
        version: "x25519-xsalsa20-poly1305"
      });

      const encryptedStr = JSON.stringify(encrypted); // JSON string
      const encryptedBytes = new TextEncoder().encode(encryptedStr); // Uint8Array

      // 8. Call contract uploadFile(cid, encryptedKeyBytes)
      setStatus("writing-on-chain");
      setProgressText("Calling contract.uploadFile(...) - sign in MetaMask to confirm transaction");

      const signer = await provider.getSigner();
      if (!CONTRACT_ADDRESS) throw new Error("CONTRACT_ADDRESS_NOT_SET");
      const contract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);

      // contract.uploadFile expects (string cid, bytes encryptedKey)
      const tx = await contract.uploadFile(cid, encryptedBytes);
      setStatus("waiting-tx");
      setProgressText("Waiting for transaction confirmation...");
      await tx.wait(1);

      setStatus("done");
      setProgressText(`Upload successful — CID: ${cid} — Tx: ${tx.hash}`);
      alert(`Upload complete\nCID: ${cid}\nTx: ${tx.hash}`);
    } catch (err) {
      console.error("Upload flow failed", err);
      setStatus("error");
      setProgressText(err.message || String(err));
      alert("Upload failed: " + (err.message || String(err)));
    }
  }

  return (
    <div style={{ maxWidth: 800, margin: "1rem auto", padding: 16, fontFamily: "system-ui, sans-serif" }}>
      <h2>Upload encrypted file → nft.storage → on-chain record</h2>

      {!account ? (
        <button onClick={connectWallet} style={{ padding: "8px 12px" }}>Connect Wallet</button>
      ) : (
        <div>Connected: {truncateAddress(account)}</div>
      )}

      <div style={{ marginTop: 16 }}>
        <input
          type="file"
          onChange={(e) => {
            if (e.target.files && e.target.files[0]) handleFile(e.target.files[0]);
          }}
        />
      </div>

      <div style={{ marginTop: 12 }}>
        <div>Status: <strong>{status}</strong></div>
        <div>{progressText}</div>
        {lastCid && <div style={{ marginTop: 8 }}>Last CID: <code>{lastCid}</code></div>}
      </div>
    </div>
  );
}

function truncateAddress(addr) {
  if (!addr) return "";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}
