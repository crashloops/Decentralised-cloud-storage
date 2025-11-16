// server/index.js
// Express upload proxy for nft.storage (CommonJS)
// Important: set up a working fetch + URLSearchParams BEFORE importing nft.storage
require("dotenv").config();

// ======= Polyfill / runtime setup (fix for "Value of 'this' must be of type URLSearchParams") =======
// Use undici's fetch implementation (stable) and Node's URLSearchParams
// This must happen BEFORE any code that pulls in '@web-std/fetch' or 'nft.storage'
const { fetch, Request, Response, Headers } = require("undici");
globalThis.fetch = fetch;
globalThis.Request = Request;
globalThis.Response = Response;
globalThis.Headers = Headers;

// Use the Node 'url' module's URLSearchParams as canonical implementation
const { URLSearchParams: NodeURLSearchParams } = require("url");
globalThis.URLSearchParams = NodeURLSearchParams;
global.URLSearchParams = NodeURLSearchParams;

// ==================================================================================================

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const morgan = require("morgan");
const axios = require("axios");
const FormData = require("form-data");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
// Trim whitespace and newlines from API key (common issue)
const NFT_KEY = process.env.NFT_STORAGE_API_KEY ? process.env.NFT_STORAGE_API_KEY.trim() : null;
if (!NFT_KEY) {
  console.error("NFT_STORAGE_API_KEY missing in environment");
  process.exit(1);
}

// Validate API key format (should be like: xxxxxxxx.xxxxxxxxxxxxx...)
if (!/^[a-zA-Z0-9]+\.[a-zA-Z0-9]+/.test(NFT_KEY)) {
  console.error("WARNING: NFT_STORAGE_API_KEY format looks invalid. Expected format: xxxxxxxx.xxxxxxxxxxxxx");
}

const MAX_UPLOAD_MB = parseInt(process.env.MAX_UPLOAD_MB || "512", 10); // MB
const UPLOAD_SECRET = process.env.UPLOAD_SECRET || null;
const NODE_ENV = process.env.NODE_ENV || "development";

// In production, UPLOAD_SECRET is required
if (NODE_ENV === "production" && !UPLOAD_SECRET) {
  console.error("CRITICAL: UPLOAD_SECRET must be set in production");
  process.exit(1);
}

const app = express();

// Nonce store for replay prevention (in-memory for single-instance)
const nonceStore = new Map();
const NONCE_TTL = 10 * 60 * 1000; // 10 minutes
const MAX_NONCES = 10000;
setInterval(() => {
  const now = Date.now();
  for (const [nonce, timestamp] of nonceStore.entries()) {
    if (now - timestamp > NONCE_TTL) nonceStore.delete(nonce);
  }
  if (nonceStore.size > MAX_NONCES) {
    const entries = Array.from(nonceStore.entries())
      .sort((a, b) => a[1] - b[1])
      .slice(0, nonceStore.size - MAX_NONCES);
    for (const [nonce] of entries) nonceStore.delete(nonce);
  }
}, 60000);

// Middlewares
app.use(helmet());

const FRONTEND_ORIGIN_STR = process.env.FRONTEND_ORIGIN || "http://localhost:5173";
const ALLOWED_ORIGINS = FRONTEND_ORIGIN_STR.split(",").map(s => s.trim()).filter(Boolean);

if (NODE_ENV === "production" && ALLOWED_ORIGINS.length === 0) {
  console.error("CRITICAL: FRONTEND_ORIGIN must be set in production");
  process.exit(1);
}

app.use(cors({
  origin: (origin, callback) => {
    if (!origin && NODE_ENV === "development") return callback(null, true);
    if (!origin) return callback(new Error("CORS: Origin not allowed"));
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    console.warn(`CORS: Rejected origin: ${origin}`);
    callback(new Error("CORS: Origin not allowed"));
  },
  credentials: true
}));
app.use(express.json({ limit: "1mb" }));
app.use(morgan("combined"));

const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || "60000", 10),
  max: parseInt(process.env.RATE_LIMIT_MAX || "60", 10),
  standardHeaders: true,
  legacyHeaders: false
});
app.use(limiter);

// Multer (in-memory)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 }
});

// IPFS Storage API endpoint
// Note: NFT.Storage Classic was decommissioned in 2024
// Using direct IPFS pinning service as alternative
// You can use Pinata, Web3.Storage, or any other IPFS pinning service
const IPFS_PINNING_API = process.env.IPFS_PINNING_API || "https://api.pinata.cloud";
const IPFS_API_KEY = process.env.IPFS_API_KEY || NFT_KEY; // Fallback to NFT_KEY if IPFS_API_KEY not set
const USE_PINATA = process.env.USE_PINATA === "true" || false;

// Direct IPFS upload function (works with Pinata, Web3.Storage, or NFT.Storage if still available)
async function uploadToIPFS(buffer, filename = "file", contentType = "application/octet-stream") {
  const formData = new FormData();
  formData.append("file", buffer, {
    filename: filename,
    contentType: contentType,
  });

  // Clean API key
  const cleanApiKey = IPFS_API_KEY ? IPFS_API_KEY.trim().replace(/\s+/g, '') : null;
  if (!cleanApiKey) {
    throw new Error("IPFS_API_KEY or NFT_STORAGE_API_KEY must be set in environment");
  }

  const apiKeyPreview = cleanApiKey ? `${cleanApiKey.substring(0, 10)}...` : 'NOT SET';
  console.log(`[IPFS] Uploading file "${filename}" (${buffer.length} bytes) with API key: ${apiKeyPreview}`);

  try {
    let response;
    
    if (USE_PINATA) {
      // Pinata API format
      response = await axios.post(`${IPFS_PINNING_API}/pinning/pinFileToIPFS`, formData, {
        headers: {
          ...formData.getHeaders(),
          pinata_api_key: cleanApiKey,
          pinata_secret_api_key: process.env.PINATA_SECRET_API_KEY || cleanApiKey,
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        validateStatus: function (status) {
          return status >= 200 && status < 600;
        },
      });

      if (response.status >= 400) {
        const errorMsg = response.data ? JSON.stringify(response.data) : response.statusText;
        throw new Error(`Pinata API error (${response.status}): ${errorMsg}`);
      }

      // Pinata returns { IpfsHash: "..." }
      if (response.data && response.data.IpfsHash) {
        console.log(`[IPFS] Upload successful via Pinata, CID: ${response.data.IpfsHash}`);
        return response.data.IpfsHash;
      }
    } else {
      // Try NFT.Storage format first (may still work for some keys)
      const NFT_STORAGE_API = "https://api.nft.storage";
      response = await axios.post(`${NFT_STORAGE_API}/upload`, formData, {
        headers: {
          ...formData.getHeaders(),
          Authorization: `Bearer ${cleanApiKey}`,
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        validateStatus: function (status) {
          return status >= 200 && status < 600;
        },
      });

      if (response.status >= 400) {
        const errorMsg = response.data ? JSON.stringify(response.data) : response.statusText;
        if (response.status === 401 && response.data?.error?.code === "ERROR_MALFORMED_TOKEN") {
          throw new Error(`NFT.Storage API key is malformed or invalid. NFT.Storage Classic was decommissioned in 2024. Please use Pinata or another IPFS service. Set USE_PINATA=true and configure PINATA_API_KEY in your .env file.`);
        }
        throw new Error(`NFT.Storage API error (${response.status}): ${errorMsg}`);
      }

      // NFT.Storage API returns { ok: true, value: { cid: "..." } }
      if (response.data && response.data.value && response.data.value.cid) {
        console.log(`[IPFS] Upload successful via NFT.Storage, CID: ${response.data.value.cid}`);
        return response.data.value.cid;
      }
      if (response.data && response.data.cid) {
        console.log(`[IPFS] Upload successful via NFT.Storage, CID: ${response.data.cid}`);
        return response.data.cid;
      }
    }
    
    throw new Error(`Invalid response format: ${JSON.stringify(response.data)}`);
  } catch (error) {
    if (error.response) {
      const status = error.response.status;
      const statusText = error.response.statusText;
      const errorData = error.response.data;
      
      console.error(`[IPFS] Upload failed: ${status} ${statusText}`, errorData);
      throw error; // Re-throw with the detailed error message
    }
    console.error(`[IPFS] Upload error:`, error.message);
    throw error;
  }
}

// HMAC verification (timestamp in milliseconds)
function verifyHmac(req) {
  if (!UPLOAD_SECRET) {
    if (NODE_ENV === "production") return false;
    return true;
  }

  const ts = req.header("x-upload-ts");
  const nonce = req.header("x-upload-nonce");
  const sig = req.header("x-upload-signature");

  if (!ts || !nonce || !sig) {
    console.warn("HMAC verification failed: Missing headers", { hasTs: !!ts, hasNonce: !!nonce, hasSig: !!sig });
    return false;
  }

  const timestamp = Number(ts);
  if (isNaN(timestamp)) {
    console.warn("HMAC verification failed: Invalid timestamp", { ts });
    return false;
  }
  const age = Math.abs(Date.now() - timestamp);
  if (age > 5 * 60 * 1000) {
    console.warn("HMAC verification failed: Timestamp too old", { age: Math.round(age / 1000) + "s" });
    return false;
  }

  if (nonceStore.has(nonce)) {
    console.warn(`HMAC verification failed: Replay attack detected - nonce ${nonce} reused`);
    return false;
  }

  const payload = `${ts}.${nonce}`;
  const h = crypto.createHmac("sha256", UPLOAD_SECRET).update(payload).digest("hex");
  if (h !== sig) {
    console.warn("HMAC verification failed: Invalid signature", {
      expected: h.substring(0, 16) + "...",
      received: sig.substring(0, 16) + "..."
    });
    return false;
  }

  nonceStore.set(nonce, Date.now());
  return true;
}

// Health
app.get("/health", (req, res) => res.json({ ok: true }));

// Upload endpoint (single file)
app.post("/upload", upload.single("file"), (req, res, next) => {
  if (req.file === undefined && req.body && Object.keys(req.body).length === 0) {
    return res.status(400).json({ error: "No file provided under 'file' field" });
  }
  next();
}, async (req, res) => {
  try {
    if (!verifyHmac(req)) return res.status(401).json({ error: "Unauthorized", detail: "HMAC authentication failed" });

    if (!req.file) {
      if (req.headers['content-length'] && parseInt(req.headers['content-length']) > MAX_UPLOAD_MB * 1024 * 1024) {
        return res.status(413).json({ error: "File too large", detail: `Maximum file size is ${MAX_UPLOAD_MB}MB` });
      }
      return res.status(400).json({ error: "No file provided under 'file' field" });
    }

    if (req.file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      return res.status(413).json({
        error: "File too large",
        detail: `File size ${Math.round(req.file.size / 1024 / 1024)}MB exceeds maximum of ${MAX_UPLOAD_MB}MB`
      });
    }

    const originalName = req.file.originalname || "chunk.bin";

     // Upload directly to IPFS (NFT.Storage, Pinata, or other service)
     let cid;
     try {
       cid = await uploadToIPFS(
         req.file.buffer,
         originalName,
         req.file.mimetype || "application/octet-stream"
       );
     } catch (storageErr) {
       console.error("NFT.Storage error:", storageErr);
       return res.status(502).json({
         error: "Storage service error",
         detail: storageErr.response?.data?.message || storageErr.message || "Failed to store file to IPFS"
       });
     }

    // Basic CID sanity check
    if (!cid || typeof cid !== "string" || cid.length < 8) {
      console.error(`Invalid CID format: ${cid}`);
      return res.status(500).json({ error: "Invalid CID returned from storage", detail: `Received invalid CID: ${cid}` });
    }

    return res.json({ cid, name: originalName });
  } catch (err) {
    console.error("Upload failed:", err);
    return res.status(500).json({ error: "Upload failed", detail: err.message || String(err) });
  }
});

// metadata upload
app.post("/metadata", upload.single("file"), async (req, res) => {
  try {
    if (!verifyHmac(req)) return res.status(401).json({ error: "Unauthorized", detail: "HMAC authentication failed" });

    let cid;
    if (req.file) {
      if (req.file.size > MAX_UPLOAD_MB * 1024 * 1024) {
        return res.status(413).json({
          error: "File too large",
          detail: `File size ${Math.round(req.file.size / 1024 / 1024)}MB exceeds maximum of ${MAX_UPLOAD_MB}MB`
        });
      }
       try {
         cid = await uploadToIPFS(
           req.file.buffer,
           req.file.originalname || "metadata.json",
           req.file.mimetype || "application/json"
         );
       } catch (storageErr) {
         console.error("NFT.Storage error:", storageErr);
         return res.status(502).json({
           error: "Storage service error",
           detail: storageErr.response?.data?.message || storageErr.message || "Failed to store metadata to IPFS"
         });
       }
    } else if (req.body && Object.keys(req.body).length > 0) {
      const jsonStr = JSON.stringify(req.body);
      if (jsonStr.length > 1024 * 1024) {
        return res.status(413).json({
          error: "Metadata too large",
          detail: `Metadata size ${Math.round(jsonStr.length / 1024)}KB exceeds maximum of 1MB`
        });
      }
       const jsonBuffer = Buffer.from(jsonStr, 'utf-8');
       try {
         cid = await uploadToIPFS(jsonBuffer, "metadata.json", "application/json");
       } catch (storageErr) {
         console.error("NFT.Storage error:", storageErr);
         return res.status(502).json({
           error: "Storage service error",
           detail: storageErr.response?.data?.message || storageErr.message || "Failed to store metadata to IPFS"
         });
       }
    } else {
      return res.status(400).json({
        error: "No metadata provided",
        detail: "Send JSON body or a file field named 'file'"
      });
    }

    if (!cid || typeof cid !== "string" || cid.length < 8) {
      console.error(`Invalid CID format: ${cid}`);
      return res.status(500).json({
        error: "Invalid CID returned from storage",
        detail: `Received invalid CID: ${cid}`
      });
    }

    return res.json({ cid });
  } catch (err) {
    console.error("Metadata upload failed:", err);
    return res.status(500).json({ error: "Metadata upload failed", detail: err.message || String(err) });
  }
});

// gateway redirect
app.get("/gateway/:cid", async (req, res) => {
  const cid = req.params.cid;
  if (!/^[a-zA-Z0-9]/.test(cid)) {
    return res.status(400).json({ error: "Invalid CID format" });
  }
  try {
    const url = `https://${cid}.ipfs.nftstorage.link/`;
    return res.redirect(url);
  } catch (err) {
    console.error("Gateway redirect failed:", err);
    return res.status(500).json({ error: "gateway redirect failed" });
  }
});

// Multer error handler
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error: "File too large",
        detail: `Maximum file size is ${MAX_UPLOAD_MB}MB`
      });
    }
    console.error("Multer error:", err);
    return res.status(400).json({ error: "File upload error", detail: err.message });
  }
  next(err);
});

// General error handler
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({
    error: "Internal server error",
    detail: NODE_ENV === "development" ? err.message : "An unexpected error occurred"
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${NODE_ENV}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Allowed origins: ${ALLOWED_ORIGINS.join(", ")}`);
  console.log(`HMAC authentication: ${UPLOAD_SECRET ? "ENABLED" : "DISABLED (development only)"}`);
  if (NODE_ENV === "production") {
    console.log("⚠️  Production mode: Ensure UPLOAD_SECRET is set and use Redis for nonce store in multi-instance deployments");
  } else {
    console.log("⚠️  Development mode: Using in-memory nonce store (not safe for multi-instance)");
  }
});
