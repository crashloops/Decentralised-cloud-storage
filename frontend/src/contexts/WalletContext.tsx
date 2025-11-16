/**
 * WalletContext for MetaMask integration
 * Provides wallet connection, encryption/decryption helpers
 */

import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from "react";
import { ethers } from "ethers";

interface WalletContextType {
  account: string | null;
  provider: ethers.providers.Web3Provider | null;
  signer: ethers.Signer | null;
  connect: () => Promise<string | null>;
  disconnect: () => void;
  getEncryptionPublicKey: (account: string) => Promise<string>; // Legacy - kept for compatibility
  deriveEncryptionKeypair: () => Promise<{ publicKeyBase64: string; keyPair: any }>;
  decryptWithSignature: (encryptedData: any, account: string) => Promise<string>;
  isConnected: boolean;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<string | null>(null);
  const [provider, setProvider] = useState<ethers.providers.Web3Provider | null>(null);
  const [signer, setSigner] = useState<ethers.Signer | null>(null);

  // Stable callback for account changes
  const handleAccountsChanged = useCallback((accounts: string[] = []) => {
    if (!accounts || accounts.length === 0) {
      setAccount(null);
      setProvider(null);
      setSigner(null);
      return;
    }
    const addr = accounts[0];
    setAccount(addr);
    try {
      const prov = new ethers.providers.Web3Provider(window.ethereum);
      setProvider(prov);
      setSigner(prov.getSigner());
    } catch (err) {
      console.error("Error creating provider/signer:", err);
      setProvider(null);
      setSigner(null);
    }
  }, []);

  useEffect(() => {
    if (!window.ethereum) return undefined;

    // Initial check
    window.ethereum
      .request({ method: "eth_accounts" })
      .then((accounts: string[]) => {
        if (accounts && accounts.length) {
          handleAccountsChanged(accounts);
        }
      })
      .catch((err: any) => {
        console.warn("eth_accounts failed", err);
      });

    // Add listeners
    window.ethereum.on("accountsChanged", handleAccountsChanged);
    const onChainChanged = () => {
      // Reload is typical but ensure listener removal too
      window.location.reload();
    };
    window.ethereum.on("chainChanged", onChainChanged);

    // Cleanup
    return () => {
      try {
        if (window.ethereum?.removeListener) {
          window.ethereum.removeListener("accountsChanged", handleAccountsChanged);
          window.ethereum.removeListener("chainChanged", onChainChanged);
        }
      } catch (err) {
        // Ignore - best effort cleanup
        console.warn("Error removing ethereum listeners", err);
      }
    };
  }, [handleAccountsChanged]);

  async function connect(): Promise<string | null> {
    if (!window.ethereum) {
      alert("MetaMask is not installed. Please install MetaMask to continue.");
      return null;
    }

    try {
      const accounts = await window.ethereum.request({
        method: "eth_requestAccounts",
      });
      handleAccountsChanged(accounts);
      return accounts[0] || null;
    } catch (err) {
      console.error("Failed to connect wallet:", err);
      return null;
    }
  }

  function disconnect() {
    setAccount(null);
    setProvider(null);
    setSigner(null);
  }

  // Legacy function - kept for backward compatibility but deprecated
  async function getEncryptionPublicKey(accountParam?: string): Promise<string> {
    console.warn('[WalletContext] getEncryptionPublicKey is deprecated. Use deriveEncryptionKeypair instead.');
    const result = await deriveEncryptionKeypair();
    return result.publicKeyBase64;
  }

  // New signature-based key derivation (replaces deprecated eth_getEncryptionPublicKey)
  async function deriveEncryptionKeypair(): Promise<{ publicKeyBase64: string; keyPair: any }> {
    if (!signer) {
      throw new Error("Signer not available. Please connect your wallet.");
    }
    if (!account) {
      throw new Error("No wallet account selected");
    }
    
    const { requestEncryptionKeypair } = await import("../utils/keyDerivation");
    return await requestEncryptionKeypair(signer, account);
  }

  // New signature-based decryption (replaces deprecated eth_decrypt)
  async function decryptWithSignature(encryptedData: any, accountParam?: string): Promise<string> {
    const acct = accountParam || account;
    if (!acct) {
      throw new Error("No wallet account selected");
    }
    if (!signer) {
      throw new Error("Signer not available. Please connect your wallet.");
    }
    
    // Use pure browser decryption with signature-based key derivation
    const { requestDecryptionFromMetaMask } = await import("../utils/decryption");
    return await requestDecryptionFromMetaMask(encryptedData, signer, acct);
  }

  return (
    <WalletContext.Provider
      value={{
        account,
        provider,
        signer,
        connect,
        disconnect,
        getEncryptionPublicKey, // Legacy - kept for compatibility
        deriveEncryptionKeypair, // New signature-based method
        decryptWithSignature, // New signature-based decryption
        isConnected: !!account,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletContextType {
  const context = useContext(WalletContext);
  if (context === undefined) {
    throw new Error("useWallet must be used within a WalletProvider");
  }
  return context;
}

// Extend Window interface for TypeScript
declare global {
  interface Window {
    ethereum?: any;
  }
}

