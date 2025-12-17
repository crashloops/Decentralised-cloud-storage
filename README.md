# IOMP - Decentralized Cloud Storage


A **production-ready** decentralized file storage system with:
- ✅ Chunked file upload/download with AES-GCM encryption
- ✅ IPFS storage via NFT.Storage
- ✅ Smart contract integration for access control
- ✅ MetaMask wallet integration
- ✅ Secure key management (keys never exposed in UI/URLs)
- ✅ HMAC authentication
- ✅ Grant access functionality
- ✅ Shared files query
- ✅ Complete error handling

**Status:** ✅ **PRODUCTION READY** - All critical issues fixed (see FIXES_APPLIED.md)

## Setup Instructions

### 1. Backend Setup

1. Navigate to `server/` directory:
```bash
cd server
```

2. Install dependencies:
```bash
npm install
```

3. Create `.env` file:
```bash
# Required
NFT_STORAGE_API_KEY=your_nft_storage_api_key_here

# Optional
PORT=3000
FRONTEND_ORIGIN=http://localhost:5173
UPLOAD_SECRET=
MAX_UPLOAD_MB=512
```

4. Start the server:
```bash
npm start
# or for development with auto-reload:
npm run dev
```

The server will run on port 3000 (or your configured PORT). Verify it's running:
```bash
curl http://localhost:3000/health
# Should return: {"ok":true}
```

### 2. Frontend Setup

1. Navigate to `frontend/` directory:
```bash
cd frontend
```

2. Install dependencies:
```bash
npm install
```

3. Create `.env` file:
```bash
# Required
VITE_PROXY_URL=http://localhost:3000
VITE_CONTRACT_ADDRESS=your_deployed_contract_address

# Optional (for development)
# VITE_NETWORK=localhost
```

4. Start the development server:
```bash
npm run dev
```

The frontend will run on `http://localhost:5173`

### 3. Smart Contract Setup

1. Deploy the `TimeBoundFileRegistry` contract to your network (Hardhat/Anvil/Testnet/Mainnet)
2. Update `VITE_CONTRACT_ADDRESS` in frontend `.env` with the deployed contract address
3. Ensure the contract ABI matches `frontend/src/contracts/TimeBoundFileRegistry.abi.json`

## Features

### Upload Flow
1. User selects file(s) to upload
2. File is encrypted with AES-GCM (chunked)
3. Each encrypted chunk is uploaded to IPFS via proxy
4. Metadata JSON is created and uploaded
5. AES key is encrypted with owner's public key (MetaMask)
6. File is registered on-chain (optional, if `autoRegister` is enabled)

### Download Flow
1. User requests file download
2. System checks access via smart contract
3. Encrypted key is retrieved from contract
4. MetaMask decrypts the key (`eth_decrypt`)
5. Chunks are downloaded from IPFS
6. Chunks are decrypted and reassembled
7. File is downloaded to user's device

## Security Features

✅ **No keys in UI**: Encryption keys are never displayed in the user interface
✅ **No keys in URLs**: Keys are never included in share links or URL parameters
✅ **No keys in logs**: Console logging of keys is disabled
✅ **Secure storage**: Keys are encrypted with owner's public key before storage
✅ **On-chain access control**: Access is managed via smart contracts



ISC

