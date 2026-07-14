# SwiftShare LAN - Technical Architecture & Detailed Implementation

This document provides a highly detailed guide explaining **what** technologies, protocols, and algorithms SwiftShare LAN uses, and **how** they are implemented and integrated across the codebase.

---

## 📁 System Architecture Overview

SwiftShare LAN is structured as a peer-to-peer file sharing and chat application for local networks. The stack is split into a hybrid desktop app structure:

*   **Electron Main Process (`main.js`, `preload.js`)**: Spawns and manages the Node.js P2P backend server and opens the chromium window displaying the React frontend.
*   **P2P Backend Node Server (`server/`)**: Manages LAN node discovery, Socket.IO control plane communication, and orchestrates file sender/receiver instances.
*   **React Frontend Client (`client/`)**: A rich single-page application built using Vite, TypeScript, TailwindCSS, and Recharts to offer instant messaging and live transfer performance visualization.
*   **Reliable UDP Engine (`udp-engine/`)**: Implements custom connection reliability over raw UDP sockets (equivalent to a TCP Reno stack).
*   **Cryptographic & Compression Libraries (`encryption/`, `compression/`)**: Deliver end-to-end security and high compression ratios.
*   **Local Database Store (`database/`)**: Manages app state, user preferences, chats, and transfer history.

```
File Share/
├── main.js                  # Electron main process (spawns backend & browser)
├── preload.js               # Safe IPC bridge for renderer
├── database/                # JSON-based atomic write data store
├── encryption/              # Cryptographic core (ECDH & AES-256-GCM)
├── compression/             # Brotli & Gzip compression utilities
├── udp-engine/              # Custom Reliable UDP protocol implementation
│   ├── packet.js            # Packet structure, header layout, & SHA-256 checksums
│   ├── sender.js            # Sliding window sender with Reno congestion control
│   └── receiver.js          # Out-of-order buffer reassembly & ACK/SACK emitter
├── server/                  # Local P2P Node server
│   ├── index.js             # Express API & Socket.IO server mapping
│   ├── discovery.js         # Broadcast/Multicast engine
│   └── manager.js           # Ephemeral key handlers & file session controllers
└── client/                  # React + TypeScript + Tailwind + Recharts frontend
```

---

## 🛠️ Tech Stack & Dependencies

### Core Frameworks & Libraries
1.  **Electron (v33.0.0)**: Used as the desktop container to run the React UI and Node.js backend processes concurrently. It provides native OS window integration.
2.  **React (v18.3.1) & Vite (v5.3.1)**: Runs the user interface with rapid Hot Module Replacement (HMR) and bundles client assets for delivery.
3.  **TailwindCSS (v3.4.4)**: Powers the modern, glassmorphic dark-mode CSS styling.
4.  **Recharts (v2.12.7)**: Renders dynamic, real-time SVG charts of the sliding window size (`cwnd`), smoothed Round-Trip Time (`RTT`), packet loss rate, and speed (MB/s).
5.  **Express (v4.21.1)**: Exposes local server endpoints (if needed) alongside the socket server.
6.  **Socket.IO (v4.8.1)**: Acts as the secure control plane. It coordinates peer matching, ECDH key-exchanges, transfer requests/responses, and metadata synchronization.

### Native Node.js Modules
1.  **`dgram`**: Provides UDP Datagram sockets utilized in both Peer Discovery (Broadcast/Multicast) and the custom Reliable UDP file transfer engine.
2.  **`crypto`**: Implements ECDH key negotiation, SHA-256 hashing, and symmetric AES-256-GCM encryption.
3.  **`zlib`**: Provides high-performance compression algorithms (Brotli and Gzip).
4.  **`fs` & `path`**: Handles atomic database reads/writes and directory structures.

---

## 📡 1. LAN Peer Discovery (`server/discovery.js`)

To find other peers on the local network automatically without a central server, SwiftShare uses a **dual-protocol UDP discovery system**:

### Dual-Discovery Channels
1.  **UDP Broadcast**:
    *   **Port**: `41234`
    *   **Address**: `255.255.255.255`
    *   **Purpose**: Broadcasts presence to all devices on the current subnet.
2.  **UDP Multicast**:
    *   **Port**: `41235`
    *   **Multicast Group Address**: `230.1.1.1`
    *   **Purpose**: Ensures discovery works across routers and switches that might block global subnet broadcast packets but allow IP multicast traffic.

### How it Works
*   On startup, `DiscoveryService` binds to both the broadcast and multicast UDP sockets.
*   **Announcement Interval**: Every 3 seconds, the node broadcasts/multicasts a discovery payload containing:
    ```json
    {
      "type": "DISCOVER_USER",
      "instanceId": "unique-uuid-v4",
      "username": "UserNickname",
      "deviceNickname": "ComputerName",
      "port": 51234, // Dynamically bound Socket.IO port
      "ip": "192.168.1.50"
    }
    ```
*   When other nodes receive this message, they add the peer to their active list and reply immediately via **UDP Unicast** with a `USER_AVAILABLE` payload.
*   **Heartbeat Timeout**: If no discovery announce is received from a peer within 10 seconds, it is marked as offline, and a `peer-offline` event is sent to the client interface.

---

## 🔑 2. Secure Pairing & Handshake (`server/manager.js`)

When a user initiates connection/chat with another discovered peer, SwiftShare performs an ephemeral cryptographic handshake to secure all future communications.

```
[ Peer A ]                                                      [ Peer B ]
   |                                                                |
   | ----------- Socket.IO (connection-request) ------------------> | (Displays UI Prompt)
   | <---------- Socket.IO (connection-response ACCEPT) ------------ | (User approves)
   |                                                                |
   | ----------- Send ECDH Public Key A (Hex) --------------------> |
   | <---------- Send ECDH Public Key B (Hex) --------------------- |
   |                                                                |
   * Compute Shared Secret                                          * Compute Shared Secret
   * Derive AES Key via HKDF-SHA256                                 * Derive AES Key via HKDF-SHA256
```

### The Ephemeral Handshake Details (`encryption/index.js`)
1.  **Key Pair Generation**:
    *   Uses **Elliptic Curve Diffie-Hellman (ECDH)** with the **NIST prime256v1** curve.
    *   Generated dynamically using Node's `crypto.createECDH('prime256v1')`.
2.  **Shared Secret Computation**:
    *   Peer A and Peer B exchange their public keys in Hex format.
    *   Each peer computes the shared secret:
        `sharedSecret = localECDH.computeSecret(peerPublicKey, 'hex')`
3.  **Key Derivation (HKDF)**:
    *   A cryptographically strong 256-bit (32 bytes) symmetric key is derived from the shared secret using **HKDF (HMAC-based Extract-and-Expand Key Derivation Function)** with **SHA-256** as the hash function:
        ```javascript
        crypto.hkdfSync('sha256', sharedSecret, salt=Buffer(0), info=Buffer(0), 32)
        ```
    *   The session key is kept strictly in-memory and never written to disk or sent across the network.

### Symmetric Chat Encryption
*   All text chat messages are encrypted with **AES-256-GCM**.
*   Every message generates a fresh **12-byte random Initialization Vector (IV)**.
*   The payload structure emitted over Socket.IO contains:
    ```json
    {
      "ciphertext": "hex-encoded-encrypted-string",
      "iv": "hex-encoded-12-byte-iv",
      "tag": "hex-encoded-16-byte-gcm-authentication-tag"
    }
    ```
*   The receiver uses the shared session key, IV, and GCM auth tag to decrypt the message and verify its integrity.

---

## ⚡ 3. Reliable UDP Engine (`udp-engine/`)

The core innovation of SwiftShare is its **Reliable UDP Protocol Engine**, which enables high-speed local file transfers. Since raw UDP does not guarantee packet delivery, order, or congestion safety, SwiftShare implements these mechanisms manually.

### A. Packet Serialization Structure (`udp-engine/packet.js`)
Every packet sent over the UDP socket is serialized into a raw binary buffer with a fixed **61-byte header**:

| Offset (Bytes) | Size (Bytes) | Field Name | Description |
| :--- | :--- | :--- | :--- |
| **0 - 1** | 2 | `MAGIC_BYTES` | Magic signature `0x53, 0x53` ('SS') to identify SwiftShare packets. |
| **2** | 1 | `PACKET_TYPE` | `0x01` (DATA), `0x02` (ACK), `0x03` (INIT), `0x04` (FIN), `0x05` (SACK) |
| **3 - 18** | 16 | `TRANSFER_ID` | UUIDv4 identifier of the current file transfer. |
| **19 - 22** | 4 | `SEQ_NUMBER` | 32-bit unsigned integer sequence number. |
| **23 - 26** | 4 | `TOTAL_PACKETS` | Total number of packets in the session. |
| **27 - 28** | 2 | `PAYLOAD_LEN` | 16-bit unsigned integer specifying payload size. |
| **29 - 60** | 32 | `SHA256_CHECKSUM` | SHA-256 hash of the payload buffer to verify packet integrity. |
| **61+** | Variable | `PAYLOAD` | Compressed and encrypted binary data chunk (usually 1024 bytes). |

### B. Congestion Control & Sliding Window (`udp-engine/sender.js`)
The sender implements the **TCP Reno Congestion Control algorithm**:

*   **Sliding Window Size (`cwnd`)**: Controls how many outstanding unacknowledged packets can be sent. It starts at `1.0` and scales dynamically.
*   **Slow Start**: While `cwnd < ssthresh`, the window grows exponentially (increases by `1.0` for every received ACK).
*   **Congestion Avoidance**: Once `cwnd >= ssthresh`, the window grows linearly to avoid flooding the network (increases by `1.0 / floor(cwnd)` per ACK).
*   **RTT & RTO Estimation (RFC 6298)**:
    *   Measures Round-Trip Time (RTT) of packets.
    *   Calculates smoothed RTT (`srtt`) and RTT variation (`rttvar`):
        $$\text{srtt} = (1 - \alpha) \cdot \text{srtt} + \alpha \cdot \text{RTT\_Sample} \quad (\alpha = 0.125)$$
        $$\text{rttvar} = (1 - \beta) \cdot \text{rttvar} + \beta \cdot | \text{srtt} - \text{RTT\_Sample} | \quad (\beta = 0.25)$$
        $$\text{RTO} = \max(50\text{ms}, \min(3000\text{ms}, \text{srtt} + 4 \cdot \text{rttvar}))$$
*   **Timeout Handling (Packet Loss)**:
    If the oldest unacknowledged packet is not ACKed within the calculated RTO:
    1.  Consider packet lost.
    2.  Set Slow Start Threshold: `ssthresh = max(2, cwnd / 2)`.
    3.  Reset Congestion Window: `cwnd = 1.0` (enters Slow Start).
    4.  Apply exponential backoff to the RTO (`rto = min(8000, rto * 2)`).
    5.  Retransmit the lost packet.

### C. Buffer Reassembly & SACK (`udp-engine/receiver.js`)
*   **Out-of-order Buffer**: Packets that arrive out of order are stored in a key-value Map (`seqNum -> payload`).
*   **Cumulative ACK Pointer**: The receiver tracks `expectedSeqNum`. When packets fill the gaps, `expectedSeqNum` slides forward.
*   **Selective ACK (SACK)**:
    *   If packets arrive with gaps (e.g., packet 5 and 7 arrive, but 6 is missing), the receiver generates a `SACK` packet.
    *   The payload of the SACK packet contains a serialized list of out-of-order sequence numbers currently buffered.
    *   The sender reads these SACK sequence numbers, marks them as acknowledged, and **retransmits only the missing packet** (packet 6), preventing wasteful retransmission of packets 5 and 7.

---

## ⚡ 4. Compression & Encryption Pipeline

Before a file is sent over the custom reliable UDP channel, it undergoes a double-layer optimization process:

```
[ Raw File ]
     │
     ▼ (compression/index.js)
[ Compress Payload ] (Brotli or GZIP)
     │
     ▼ (encryption/index.js)
[ Encrypt ciphertext ] (AES-256-GCM)
     │
     ▼ (udp-engine/sender.js)
[ Packetization & Transmit ]
```

1.  **Compression**:
    *   Compresses the raw buffer using **Brotli** (superior ratio) or **Gzip** (faster speed).
    *   Calculates size savings: `savings = originalSize - compressedSize`.
2.  **Encryption**:
    *   Encrypts the compressed buffer using the ephemeral **AES-256-GCM** session key generated during pairing.
    *   Generates a unique `iv` and authentication `tag`.
3.  **Metadata Exchange**:
    *   The file's metadata (`fileName`, `fileSize`, `sha256Hash`, `compressionType`, `iv`, `tag`) is sent over the secure Socket.IO channel.
4.  **Decryption & Decompression**:
    *   Once all UDP packets are assembled, the receiver decrypts the entire buffer using the provided key, `iv`, and `tag`.
    *   Decompresses the plaintext buffer.
    *   Verifies the SHA-256 hash matches the expected metadata hash to guarantee no corruption.
    *   Saves the file to the user's Downloads folder.

---

## 💾 5. Local JSON Database (`database/index.js`)

The application state is persisted in a local JSON file named `swiftshare-db.json` situated in the operating system's temporary directory (`os.tmpdir()`).

### Atomic Writes
To prevent database corruption during sudden application exits, the database uses **atomic replacement writes**:
1.  Serialize the dataset to string.
2.  Write the data to a temporary file: `swiftshare-db.json.tmp`.
3.  Execute a synchronous rename operation (`fs.renameSync`) to overwrite `swiftshare-db.json` instantly.

---

## 📊 6. React UI & Telemetry (`client/`)

The user interface provides a live telemetry dashboard connected to the backend UDP engine:
*   **Connection**: Emits and listens to commands on a local Socket.IO connection at `http://localhost:SERVER_PORT?role=ui`.
*   **Telemetry charts**: Uses **Recharts Area & Line Charts** to plot performance statistics updated every 1000ms:
    *   **Congestion Window (`cwnd`)**: Shows Reno's scaling behaviour.
    *   **RTT (ms)**: Displays network latency fluctuations.
    *   **Throughput (MB/s)**: Calculates current transfer rate.
    *   **Packet Loss Rate**: Monitors channel quality.
