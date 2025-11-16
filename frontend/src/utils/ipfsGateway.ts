/**
 * Robust IPFS Gateway Fetcher
 * Handles multiple gateways, TLS errors, CORS, timeouts, and CID sanitization
 * Tries subdomain and path-style gateways with intelligent fallback
 */

/**
 * Sanitize and validate CID
 * Removes whitespace, validates format, ensures proper encoding
 */
function sanitizeCID(cid: string): string {
  if (!cid || typeof cid !== 'string') {
    throw new Error('Invalid CID: must be a non-empty string');
  }

  // Remove whitespace and trim
  let sanitized = cid.trim().replace(/\s+/g, '');

  // Remove accidental prefixes (q, Q, 0x, etc.)
  if (sanitized.startsWith('q') && sanitized.length > 1 && /^[a-zA-Z0-9]+$/.test(sanitized.slice(1))) {
    // Check if it's a valid CID without the 'q' prefix
    const withoutQ = sanitized.slice(1);
    if (/^[bBQm][a-zA-Z0-9]+$/.test(withoutQ)) {
      console.warn('[IPFS] Removed accidental "q" prefix from CID:', sanitized, '→', withoutQ);
      sanitized = withoutQ;
    }
  }

  // Remove 0x prefix if present (shouldn't be, but handle it)
  if (sanitized.startsWith('0x')) {
    sanitized = sanitized.slice(2);
  }

  // Validate CID format
  // CIDv0: starts with Qm (base58, 46 chars)
  // CIDv1: starts with b (base32, variable length)
  if (!/^[bBQm][a-zA-Z0-9]+$/.test(sanitized)) {
    throw new Error(`Invalid CID format: ${cid} (sanitized: ${sanitized}). CID must start with Qm, b, or B.`);
  }

  // CIDv0 should be exactly 46 characters (Qm + 44 base58 chars)
  if (sanitized.startsWith('Qm') && sanitized.length !== 46) {
    console.warn(`[IPFS] CIDv0 length unusual: ${sanitized.length} chars (expected 46):`, sanitized);
  }

  return sanitized;
}

/**
 * Sanitize path/filename for URL construction
 */
function sanitizePath(path: string): string {
  if (!path) return '';
  
  // Remove leading/trailing slashes, encode special characters
  return path
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .map(segment => encodeURIComponent(segment))
    .join('/');
}

/**
 * Build gateway URLs (both subdomain and path styles)
 */
function buildGatewayURLs(cid: string, path: string = ''): string[] {
  const sanitizedPath = sanitizePath(path);
  const pathSuffix = sanitizedPath ? `/${sanitizedPath}` : '';

  return [
    // Subdomain style (NFT.Storage preferred)
    `https://${cid}.ipfs.nftstorage.link${pathSuffix}`,
    
    // Path style - NFT.Storage
    `https://nftstorage.link/ipfs/${cid}${pathSuffix}`,
    
    // Public gateways (path style) - reliable fallbacks
    `https://ipfs.io/ipfs/${cid}${pathSuffix}`,
    `https://cloudflare-ipfs.com/ipfs/${cid}${pathSuffix}`,
    `https://dweb.link/ipfs/${cid}${pathSuffix}`,
    `https://gateway.pinata.cloud/ipfs/${cid}${pathSuffix}`,
    
    // Additional reliable gateways
    `https://ipfs.filebase.io/ipfs/${cid}${pathSuffix}`,
    `https://cf-ipfs.com/ipfs/${cid}${pathSuffix}`,
  ].map(url => url.replace(/([^:])\/{2,}/g, '$1/')); // Clean double slashes
}

/**
 * Classify error type for better error messages
 */
function classifyError(error: any): { type: string; message: string; retryable: boolean } {
  const msg = (error?.message || String(error)).toLowerCase();
  const name = error?.name || '';

  // TLS/SSL errors
  if (msg.includes('ssl') || msg.includes('tls') || msg.includes('certificate') || 
      msg.includes('err_ssl') || name.includes('SSL') || name.includes('TLS')) {
    return {
      type: 'TLS_ERROR',
      message: 'TLS/SSL handshake failed. This may be due to gateway certificate issues, corporate proxy, or browser TLS version.',
      retryable: true,
    };
  }

  // Network errors
  if (msg.includes('network') || msg.includes('failed to fetch') || 
      msg.includes('err_network') || name === 'TypeError') {
    return {
      type: 'NETWORK_ERROR',
      message: 'Network request failed. Check your internet connection.',
      retryable: true,
    };
  }

  // Timeout errors
  if (msg.includes('timeout') || msg.includes('aborted') || name === 'AbortError') {
    return {
      type: 'TIMEOUT',
      message: 'Request timed out. The gateway may be slow or unreachable.',
      retryable: true,
    };
  }

  // CORS errors
  if (msg.includes('cors') || msg.includes('cross-origin') || name === 'TypeError') {
    return {
      type: 'CORS_ERROR',
      message: 'CORS policy blocked the request. The gateway may not allow cross-origin requests.',
      retryable: false, // CORS won't work on retry
    };
  }

  // HTTP errors
  if (error?.status || msg.includes('status')) {
    return {
      type: 'HTTP_ERROR',
      message: `HTTP error: ${error.status || 'unknown status'}`,
      retryable: error?.status >= 500 || error?.status === 429, // Retry server errors and rate limits
    };
  }

  return {
    type: 'UNKNOWN_ERROR',
    message: error?.message || String(error),
    retryable: true,
  };
}

/**
 * Fetch from IPFS gateway with multiple fallbacks
 * 
 * @param cid - IPFS CID (will be sanitized)
 * @param path - Optional path/filename to append
 * @param timeoutMs - Request timeout in milliseconds (default: 15000)
 * @returns Blob and the URL that succeeded
 */
export async function fetchFromIPFSGateway(
  cid: string,
  path: string = '',
  timeoutMs: number = 15000
): Promise<{ blob: Blob; url: string }> {
  // Sanitize CID
  const sanitizedCID = sanitizeCID(cid);
  
  console.log('[IPFS Gateway] Fetching:', {
    originalCID: cid,
    sanitizedCID: sanitizedCID,
    path: path || '(none)',
    timeoutMs,
  });

  // Build gateway URLs
  const urls = buildGatewayURLs(sanitizedCID, path);
  
  console.log('[IPFS Gateway] Will try', urls.length, 'gateways:', urls.map(u => {
    try {
      const urlObj = new URL(u);
      return `${urlObj.hostname}${urlObj.pathname}`;
    } catch {
      return u.substring(0, 50) + '...';
    }
  }));

  // Try each gateway in sequence
  const errors: Array<{ url: string; error: any; classification: ReturnType<typeof classifyError> }> = [];
  
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    
    try {
      console.log(`[IPFS Gateway] Attempt ${i + 1}/${urls.length}:`, url);

      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
        console.warn(`[IPFS Gateway] Timeout after ${timeoutMs}ms:`, url);
      }, timeoutMs);

      // Fetch with CORS mode
      // Use 'no-cors' as fallback only if CORS fails, but try 'cors' first for better error messages
      const response = await fetch(url, {
        method: 'GET',
        mode: 'cors',
        cache: 'no-cache',
        signal: controller.signal,
        headers: {
          'Accept': '*/*',
        },
        // Add referrer policy to avoid some CORS issues
        referrerPolicy: 'no-referrer',
      });

      clearTimeout(timeoutId);

      // Check response status
      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
        (error as any).status = response.status;
        (error as any).statusText = response.statusText;
        (error as any).body = errorText.substring(0, 200);
        
        const classification = classifyError(error);
        errors.push({ url, error, classification });
        
        console.warn(`[IPFS Gateway] HTTP error ${response.status} from ${url}:`, errorText.substring(0, 100));
        
        // Don't retry non-retryable errors on other gateways
        if (!classification.retryable && response.status >= 400 && response.status < 500) {
          console.warn('[IPFS Gateway] Non-retryable client error, stopping gateway attempts');
          break;
        }
        
        continue; // Try next gateway
      }

      // Success - get blob
      const blob = await response.blob();
      
      console.log(`[IPFS Gateway] ✓ Success from ${url}:`, {
        blobSize: blob.size,
        blobType: blob.type,
        contentType: response.headers.get('content-type'),
      });

      return { blob, url };

    } catch (err: any) {
      const classification = classifyError(err);
      errors.push({ url, error: err, classification });
      
      console.error(`[IPFS Gateway] ✗ Failed ${url}:`, {
        error: err?.message || String(err),
        type: classification.type,
        retryable: classification.retryable,
      });

      // If it's a non-retryable error (like CORS), we might want to skip remaining gateways
      // But for now, continue trying all gateways
      continue;
    }
  }

  // All gateways failed - build comprehensive error message
  const errorSummary = errors.map((e, idx) => 
    `  ${idx + 1}. ${e.url}\n     → ${e.classification.type}: ${e.classification.message}`
  ).join('\n');

  const lastError = errors[errors.length - 1];
  const error = new Error(
    `All ${urls.length} IPFS gateways failed to fetch CID ${sanitizedCID}.\n\n` +
    `Tried gateways:\n${errorSummary}\n\n` +
    `Last error: ${lastError?.classification.message || lastError?.error?.message || 'Unknown error'}\n\n` +
    `Troubleshooting:\n` +
    `1. Check if CID is correct: ${sanitizedCID}\n` +
    `2. Try opening in browser: https://ipfs.io/ipfs/${sanitizedCID}\n` +
    `3. Check network connection and firewall settings\n` +
    `4. If behind corporate proxy, contact IT about IPFS gateway access`
  );

  (error as any).cause = lastError?.error;
  (error as any).errors = errors;
  (error as any).cid = sanitizedCID;

  throw error;
}

/**
 * Legacy function name for backward compatibility
 */
export async function fetchBlobFromGateway(cid: string, path: string = ''): Promise<Blob> {
  const result = await fetchFromIPFSGateway(cid, path);
  return result.blob;
}

