/**
 * Wallet connection helpers with proper error handling
 */

/**
 * Request wallet connection
 * @returns Connected account address or null if rejected/unavailable
 */
export async function connectWallet(): Promise<string | null> {
  const eth = (window as any).ethereum;
  if (!eth) return null;
  
  try {
    const accounts = await eth.request({ method: 'eth_requestAccounts' });
    return accounts?.[0] || null;
  } catch (err: any) {
    if (err?.code === 4001) {
      // User rejected connection
      return null;
    }
    console.error('connectWallet error', err);
    throw err;
  }
}

/**
 * Get current wallet account (if already connected)
 * @returns Connected account address or null
 */
export async function getWallet(): Promise<string | null> {
  const eth = (window as any).ethereum;
  if (!eth) return null;
  
  try {
    const accounts = await eth.request({ method: 'eth_accounts' });
    return accounts?.[0] || null;
  } catch (err) {
    console.warn('getWallet failed', err);
    return null;
  }
}
