# Complete Setup Guide for IOMP

## ✅ What's Been Set Up

### Backend (Server)
- ✅ Express proxy server with `/upload` and `/metadata` endpoints
- ✅ NFT.Storage integration
- ✅ CORS configured for frontend
- ✅ Health check endpoint
- ✅ Rate limiting and security middleware
- ✅ Environment variable configuration

### Frontend
- ✅ Chunked upload service with AES-GCM encryption
- ✅ Chunked download service
- ✅ WalletContext for MetaMask integration
- ✅ Contract ABI and integration utilities
- ✅ Updated App.tsx to use new chunked upload system
- ✅ Security fixes (no keys in UI/URLs/logs)

## 🚀 Quick Start

### 1. Backend Setup

```bash
cd server
npm install
```

Create `server/.env`:
```env
NFT_STORAGE_API_KEY=your_key_here
PORT=3000
FRONTEND_ORIGIN=http://localhost:5173
```

Start server:
```bash
npm start
```

Verify:
```bash
curl http://localhost:3000/health
# Should return: {"ok":true}
```

### 2. Frontend Setup

```bash
cd frontend
npm install
```

Create `frontend/.env`:
```env
VITE_PROXY_URL=http://localhost:3000
VITE_CONTRACT_ADDRESS=your_contract_address_here
```

Start frontend:
```bash
npm run dev
```

### 3. Testing the Integration

1. **Connect MetaMask**: Click "Connect" in the header
2. **Upload a file**: Drag & drop or click to select
3. **Watch console**: You should see:
   - "Starting chunked upload for..."
   - "Encrypting chunk..." (for each chunk)
   - "Upload complete: {metadataCid}"
   - "On-chain registration: {txHash}" (if autoRegister enabled)

## 📋 Verification Checklist

### Backend
- [ ] `npm start` runs without errors
- [ ] Terminal shows: "Server running on port 3000"
- [ ] `GET /health` returns `{"ok":true}`
- [ ] `POST /upload` returns 400 (file missing) when called without file
- [ ] NFT_STORAGE_API_KEY is set in `.env`

### Frontend
- [ ] `npm run dev` starts without errors
- [ ] Frontend loads at `http://localhost:5173`
- [ ] MetaMask connection works
- [ ] File upload shows progress
- [ ] Console shows chunked upload logs
- [ ] No keys/IVs visible in UI
- [ ] No keys in browser console

### Integration
- [ ] Upload completes end-to-end
- [ ] Metadata CID is displayed
- [ ] On-chain registration works (if contract configured)
- [ ] CORS allows frontend to call backend

## 🔧 Troubleshooting

### Server won't start
- Check if port 3000 is already in use
- Verify NFT_STORAGE_API_KEY is set
- Check `node server/index.js` for errors

### Frontend can't connect to backend
- Verify `VITE_PROXY_URL` matches server URL
- Check CORS settings in server
- Check browser console for CORS errors

### Upload fails
- Check MetaMask is connected
- Verify proxy URL is correct
- Check server logs for errors
- Verify NFT.Storage API key is valid

### Contract errors
- Verify contract is deployed
- Check `VITE_CONTRACT_ADDRESS` is correct
- Ensure MetaMask is on correct network
- Check contract ABI matches deployed contract

## 📁 File Structure

```
IOMP/
├── server/
│   ├── index.js              # Express proxy server
│   ├── package.json
│   └── .env                  # Server environment variables
│
├── frontend/
│   ├── src/
│   │   ├── services/
│   │   │   ├── cryptoService.ts      # AES-GCM encryption
│   │   │   ├── chunkedUpload.ts      # Chunked upload logic
│   │   │   └── chunkedDownload.ts    # Chunked download logic
│   │   ├── contexts/
│   │   │   └── WalletContext.tsx     # MetaMask integration
│   │   ├── contracts/
│   │   │   └── TimeBoundFileRegistry.abi.json
│   │   └── App.tsx                   # Main app (updated)
│   ├── package.json
│   └── .env                  # Frontend environment variables
│
└── README.md
```

## 🔐 Security Notes

- ✅ Encryption keys are never displayed in UI
- ✅ Keys are never included in URLs
- ✅ Keys are never logged to console
- ✅ Keys are encrypted with owner's public key before storage
- ✅ Access control via smart contracts
- ✅ CORS restricted to frontend origin

## 📝 Next Steps

1. Deploy smart contract to your network
2. Update `VITE_CONTRACT_ADDRESS` in frontend `.env`
3. Test full upload/download flow
4. Implement download flow with contract access check
5. Add file listing from on-chain records
6. Implement access granting UI

## 🎯 Production Checklist

- [ ] Set proper CORS origins
- [ ] Enable HMAC authentication (UPLOAD_SECRET)
- [ ] Use HTTPS for all connections
- [ ] Configure rate limiting appropriately
- [ ] Monitor NFT.Storage usage
- [ ] Set up error logging/monitoring
- [ ] Test on testnet before mainnet

