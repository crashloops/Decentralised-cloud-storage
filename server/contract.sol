// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

contract TimeBoundFileRegistry {

    struct FileRecord {
        string cid;
        bytes encryptedKey;
        uint256 timestamp;
        bool revoked;
        bool exists;
    }

    struct AccessRecord {
        bytes encryptedKeyForGrantee;
        uint256 start;
        uint256 end;
        bool revoked;
        bool exists;
    }

    mapping(address => mapping(bytes32 => FileRecord)) private uploads;
    mapping(bytes32 => mapping(address => AccessRecord)) private access;

    event FileUploaded(address indexed owner, string indexed cid, bytes32 indexed cidHash, uint256 timestamp);
    event FileUpdated(address indexed owner, string indexed cid, bytes32 indexed cidHash, uint256 timestamp);
    event FileRevoked(address indexed owner, string indexed cid, bytes32 indexed cidHash, uint256 timestamp);
    event AccessGranted(address indexed owner, address indexed grantee, string indexed cid, bytes32 cidHash, uint256 start, uint256 end, uint256 timestamp);
    event AccessRevoked(address indexed owner, address indexed grantee, string indexed cid, bytes32 cidHash, uint256 timestamp);

    function _cidHash(string memory cid) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(cid));
    }

    function _fileKey(address owner, bytes32 cidHash) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(owner, cidHash));
    }

    function uploadFile(string calldata cid, bytes calldata encryptedKey) external {
        require(bytes(cid).length > 0, "CID_REQUIRED");
        require(encryptedKey.length > 0, "ENCRYPTED_KEY_REQUIRED");

        bytes32 cidHash = _cidHash(cid);
        FileRecord storage rec = uploads[msg.sender][cidHash];
        require(!rec.exists, "ALREADY_EXISTS");

        uploads[msg.sender][cidHash] = FileRecord({
            cid: cid,
            encryptedKey: encryptedKey,
            timestamp: block.timestamp,
            revoked: false,
            exists: true
        });

        emit FileUploaded(msg.sender, cid, cidHash, block.timestamp);
    }

    function updateEncryptedKey(string calldata cid, bytes calldata newEncryptedKey) external {
        require(bytes(cid).length > 0, "CID_REQUIRED");
        require(newEncryptedKey.length > 0, "NEW_KEY_REQUIRED");

        bytes32 cidHash = _cidHash(cid);
        FileRecord storage rec = uploads[msg.sender][cidHash];
        require(rec.exists, "NOT_FOUND");
        require(!rec.revoked, "REVOKED");

        rec.encryptedKey = newEncryptedKey;
        rec.timestamp = block.timestamp;

        emit FileUpdated(msg.sender, cid, cidHash, block.timestamp);
    }

    function revokeFile(string calldata cid) external {
        bytes32 cidHash = _cidHash(cid);
        FileRecord storage rec = uploads[msg.sender][cidHash];
        require(rec.exists, "NOT_FOUND");
        require(!rec.revoked, "ALREADY_REVOKED");

        rec.revoked = true;
        rec.timestamp = block.timestamp;

        emit FileRevoked(msg.sender, cid, cidHash, block.timestamp);
    }

    function grantAccess(
        address grantee,
        string calldata cid,
        bytes calldata encryptedKeyForGrantee,
        uint256 start,
        uint256 end
    ) external {
        require(grantee != address(0), "INVALID_GRANTEE");
        require(bytes(cid).length > 0, "CID_REQUIRED");
        require(encryptedKeyForGrantee.length > 0, "ENCRYPTED_KEY_REQUIRED");
        require(end > start, "END_MUST_BE_GT_START");

        bytes32 cidHash = _cidHash(cid);

        FileRecord storage rec = uploads[msg.sender][cidHash];
        require(rec.exists, "OWNER_FILE_NOT_FOUND");
        require(!rec.revoked, "OWNER_FILE_REVOKED");

        bytes32 fk = _fileKey(msg.sender, cidHash);
        AccessRecord storage arec = access[fk][grantee];

        arec.encryptedKeyForGrantee = encryptedKeyForGrantee;
        arec.start = start;
        arec.end = end;
        arec.revoked = false;
        arec.exists = true;

        emit AccessGranted(msg.sender, grantee, cid, cidHash, start, end, block.timestamp);
    }

    function revokeAccess(address grantee, string calldata cid) external {
        require(grantee != address(0), "INVALID_GRANTEE");
        bytes32 cidHash = _cidHash(cid);
        bytes32 fk = _fileKey(msg.sender, cidHash);

        AccessRecord storage arec = access[fk][grantee];
        require(arec.exists, "ACCESS_NOT_FOUND");
        require(!arec.revoked, "ACCESS_ALREADY_REVOKED");

        arec.revoked = true;

        emit AccessRevoked(msg.sender, grantee, cid, cidHash, block.timestamp);
    }

    function getAccess(
        address owner,
        string calldata cid,
        address grantee
    ) external view returns (bytes memory encryptedKeyForGrantee, uint256 start, uint256 end, bool revoked, bool exists) {
        bytes32 cidHash = _cidHash(cid);
        bytes32 fk = _fileKey(owner, cidHash);
        AccessRecord storage arec = access[fk][grantee];
        return (arec.encryptedKeyForGrantee, arec.start, arec.end, arec.revoked, arec.exists);
    }

    function isAccessActive(address owner, string calldata cid, address grantee) public view returns (bool authorized) {
        bytes32 cidHash = _cidHash(cid);

        FileRecord storage rec = uploads[owner][cidHash];
        if (!rec.exists || rec.revoked) {
            return false;
        }

        bytes32 fk = _fileKey(owner, cidHash);
        AccessRecord storage arec = access[fk][grantee];
        if (!arec.exists || arec.revoked) {
            return false;
        }

        uint256 nowTs = block.timestamp;
        return (arec.start <= nowTs && nowTs < arec.end);
    }

    function getFile(address owner, string calldata cid)
        external
        view
        returns (
            string memory cidOut,
            bytes memory encryptedKeyOut,
            uint256 timestampOut,
            bool revokedOut,
            bool existsOut
        )
    {
        bytes32 cidHash = _cidHash(cid);
        FileRecord storage rec = uploads[owner][cidHash];
        return (rec.cid, rec.encryptedKey, rec.timestamp, rec.revoked, rec.exists);
    }
}
