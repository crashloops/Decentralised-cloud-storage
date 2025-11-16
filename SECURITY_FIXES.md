# Security Fixes Summary

## Critical Issues Fixed (10/10 Severity)

### 1. ✅ Replay Attack Prevention (Nonce Tracking)
**Severity: 10/10 - CRITICAL**

**Problem:** HMAC verification allowed replay attacks. An attacker could capture a valid request and replay it multiple times within the 5-minute timestamp window.

**Fix:**
- Added in-memory nonce store with TTL (10 minutes)
- Nonces are tracked and rejected if reused
- Automatic cleanup of old nonces to prevent memory leaks
- **Production Note:** For multi-instance deployments, use Redis or a shared store instead of in-memory Map

**Code Location:** `server/index.js` - `verifyHmac()` function and nonce store

### 2. ✅ Production Security Hardening
**Severity: 10/10 - CRITICAL**

**Problem:** Server failed open in production - allowed unauthenticated uploads if `UPLOAD_SECRET` was not set.

**Fix:**
- Server now **fails closed** in production
- `UPLOAD_SECRET` is **required** in production (startup check)
- `FRONTEND_ORIGIN` must be explicitly set in production
- Development mode still allows relaxed security for testing

**Code Location:** `server/index.js` - Startup checks

### 3. ✅ Race Condition in Worker Allocation
**Severity: 9/10 - CRITICAL**

**Problem:** Two concurrent workers could get the same chunk index, causing duplicate uploads or state corruption.

**Fix:**
- Atomic index allocation using synchronous `nextIndex++` operation
- Double-check before writing to state (prevents race conditions)
- Workers skip already-uploaded chunks safely

**Code Location:** `frontend/src/services/chunkedUpload.ts` - `worker()` function

## High Priority Issues Fixed (7-8/10 Severity)

### 4. ✅ Strict CORS Configuration
**Severity: 8/10 - HIGH**

**Problem:** Permissive CORS defaults could allow unauthorized origins in production.

**Fix:**
- CORS now validates against explicit allowlist
- Supports comma-separated origins: `FRONTEND_ORIGIN=http://localhost:5173,https://app.example.com`
- Production requires explicit origin configuration
- Development mode allows no-origin requests (for testing tools)

**Code Location:** `server/index.js` - CORS middleware

### 5. ✅ Input Validation & CID Validation
**Severity: 7/10 - HIGH**

**Problem:** Missing validation could allow injection attacks or invalid data.

**Fix:**
- CID format validation (prevents injection in gateway endpoint)
- File size validation (double-check beyond multer limits)
- Metadata size limits (1MB max)
- Proper error messages without exposing internals

**Code Location:** `server/index.js` - All endpoints

## React Hook Usage

### ✅ No Issues Found
**Status: Already Correct**

The `useWallet` hook is called unconditionally at the top level of components, following React rules. No conditional hook calls detected.

**Code Location:** `frontend/src/App.tsx` - Line 36

## Security Rating Summary

| Issue | Severity | Status | Impact |
|-------|----------|--------|--------|
| Replay Attack (Nonce) | 10/10 | ✅ Fixed | Prevents request replay attacks |
| Production Fail-Open | 10/10 | ✅ Fixed | Server fails closed in production |
| Race Condition | 9/10 | ✅ Fixed | Prevents duplicate uploads/corruption |
| Permissive CORS | 8/10 | ✅ Fixed | Strict origin validation |
| Input Validation | 7/10 | ✅ Fixed | Prevents injection attacks |
| React Hooks | N/A | ✅ Verified | No issues found |

## Production Deployment Checklist

### Required Environment Variables
```bash
# Server (.env)
NODE_ENV=production
NFT_STORAGE_API_KEY=your_key_here
UPLOAD_SECRET=your_secret_here  # REQUIRED in production
FRONTEND_ORIGIN=https://your-app.com,https://www.your-app.com
PORT=3000
```

### Multi-Instance Deployment
⚠️ **Important:** The current nonce store uses an in-memory Map, which is **NOT safe** for multi-instance deployments.

**For production with multiple server instances:**
1. Use Redis for nonce storage
2. Implement distributed locking if needed
3. Consider using a service like AWS ElastiCache or Redis Cloud

### Monitoring Recommendations
- Monitor nonce store size (should stay under MAX_NONCES = 10000)
- Alert on replay attack detections
- Log all CORS rejections
- Monitor CID validation failures

## Testing the Fixes

### Test Replay Attack Prevention
```bash
# 1. Make a valid request and capture headers
curl -X POST http://localhost:3000/upload \
  -F "file=@test.txt" \
  -H "x-upload-ts: 1234567890" \
  -H "x-upload-nonce: abc123" \
  -H "x-upload-signature: valid_signature"

# 2. Replay the same request (should fail)
curl -X POST http://localhost:3000/upload \
  -F "file=@test.txt" \
  -H "x-upload-ts: 1234567890" \
  -H "x-upload-nonce: abc123" \
  -H "x-upload-signature: valid_signature"
# Expected: 401 Unauthorized (nonce already used)
```

### Test Production Security
```bash
# Try to start server without UPLOAD_SECRET in production
NODE_ENV=production npm start
# Expected: Server exits with error "CRITICAL: UPLOAD_SECRET must be set"
```

### Test Race Condition Fix
- Upload a large file (10MB+) with concurrency=4
- Monitor console for duplicate chunk uploads
- Verify all chunks upload exactly once
- Check metadata JSON has correct chunk count

## Additional Security Recommendations

1. **Rate Limiting:** Already implemented, but consider per-IP limits
2. **Request Size Limits:** Already implemented via multer
3. **HTTPS:** Always use HTTPS in production
4. **Secrets Management:** Use environment variables or secret management services (AWS Secrets Manager, HashiCorp Vault)
5. **Logging:** Implement structured logging with sensitive data redaction
6. **Monitoring:** Set up alerts for security events (replay attacks, CORS rejections)

## Notes

- All fixes maintain backward compatibility for development mode
- Production mode is now fail-closed by default
- Nonce store cleanup runs every minute to prevent memory leaks
- CID validation uses regex pattern matching (basic but effective)

