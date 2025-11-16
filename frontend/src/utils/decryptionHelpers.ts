/**
 * Helper functions for ciphertext normalization
 * Extracted to avoid circular dependencies
 */

/**
 * Normalize ciphertext input to exact format
 * Handles: double-stringified JSON, hex bytes, Uint8Array, etc.
 */
export function normalizeCiphertextInput(raw: any): string {
  let s = raw;

  // If it's a Uint8Array / ArrayBuffer-like, convert to string
  if (s instanceof Uint8Array || (typeof s === 'object' && s?.buffer instanceof ArrayBuffer)) {
    try {
      s = new TextDecoder().decode(s);
    } catch (e) {
      s = String(s);
    }
  }

  // If it's hex (0x...): convert hex bytes to utf-8 string
  if (typeof s === 'string' && s.startsWith('0x')) {
    try {
      const hex = s.slice(2);
      let bytes = new Uint8Array(hex.length / 2);
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
      }
      s = new TextDecoder().decode(bytes);
    } catch (e) {
      // fallback to original hex string
    }
  }

  // If the string is double-quoted (JSON stringified twice)
  if (typeof s === 'string' && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))) {
    try {
      const parsed = JSON.parse(s);
      if (typeof parsed === 'string') {
        s = parsed;
      } else {
        s = JSON.stringify(parsed);
      }
    } catch (e) {
      s = s.slice(1, -1);
    }
  }

  // If s is object already, stringify it
  if (typeof s === 'object' && s !== null) {
    s = JSON.stringify(s);
  }

  // Trim whitespace
  if (typeof s === 'string') s = s.trim();

  return s;
}

