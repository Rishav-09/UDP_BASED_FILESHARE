# SwiftShare LAN - Secure UDP-Based P2P Sharing & Chat

SwiftShare LAN is a high-speed, secure, peer-to-peer file sharing and chat application designed to run on Local Area Networks (LAN) and Wi-Fi networks. It implements a custom, reliable UDP protocol inspired by TCP Reno to achieve high-performance transfers with congestion control, and features end-to-end encrypted chat sessions.

---

## 🌟 Key Features

1. **Dual LAN Discovery**: Utilizes both UDP Broadcast (`255.255.255.255:41234`) and UDP Multicast (`230.1.1.1:41235`) to automatically discover active peers on the same network under varying router configurations.
2. **Ephemeral Secure Handshake**: Uses Elliptic Curve Diffie-Hellman (ECDH) key exchange (NIST prime256v1 curve) to securely derive a 256-bit symmetric session key without transmitting it over the network.
3. **End-to-End Encrypted Chat**: Encrypts all real-time chat messages using AES-256-GCM. Features delivery receipts, typing indicators, and message history.
4. **Reliable UDP Engine**: Builds reliability over UDP using sequence numbering, cumulative ACKs, Selective ACKs (SACKs), and dynamic Retransmission Timeout (RTO) calculations.
5. **TCP Reno Congestion Control**: Implements Slow Start (exponential window growth), Congestion Avoidance (linear growth), Fast Retransmit, and multiplicative window scaling on packet loss.
6. **Double-Layer Optimization**: Compresses payloads using Brotli or Gzip compression before encrypting them with AES-256-GCM, maximizing bandwidth savings and security.
7. **Interactive Live Dashboard**: Renders real-time telemetry graphs showing congestion window sizes, smoothed round-trip time (RTT), packet loss rate, and throughput MB/s.

---

## 📁 System Architecture

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

## 🚀 How to Run the Application (Offline-Ready)

This project has been configured to run completely offline without requiring internet access or the `npm install` command at runtime.

### Option 1: Standard Offline Setup (Using pre-packaged Electron binaries)

Follow these steps to run the application on any restricted or offline machine:

#### Step 1: Pre-Build the Client (Done on an internet-connected PC)
1. In the `client/` directory, build the React frontend:
   ```bash
   cd client
   npm run build
   ```
   *This compiles all React components into a static `client/dist` bundle.*

#### Step 2: Download Electron Portable
1. Go to the [Electron Releases Page](https://github.com/electron/electron/releases) on any internet-connected device.
2. Download the official zip file for Windows (e.g., `electron-v33.0.0-win32-x64.zip`).
3. Copy this zip file to your offline PC using a USB drive.
4. Extract it (for example, into `C:\bin\electron`).

#### Step 3: Run the Application Offline
On the offline PC, open PowerShell in the project directory and run:
```powershell
C:\bin\electron\electron.exe "C:\Users\offic\OneDrive\Desktop\File Share"
```
*(Make sure to replace `"C:\Users\offic\OneDrive\Desktop\File Share"` with your actual workspace folder path).*

---

### Option 2: Development Mode (With Internet Access)

If you are on an internet-connected PC and want to run it in standard development mode:

1. **Install Dependencies**:
   ```bash
   npm run install:all
   ```
2. **Start Development Server**:
   ```bash
   npm run dev:all
   ```
3. **Double Click to Run**:
   You can also double-click `start.bat` in the root folder to boot the app instantly.

---

## 💻 How Sender & Receiver Connect & Transfer Data

Here is the exact step-by-step process of how two devices (Sender and Receiver) interact from basic matching to file assembly:

```
[ Sender (Peer A) ]                                       [ Receiver (Peer B) ]
        |                                                           |
        | ------------- UDP Broadcast (DISCOVER_USER) ------------> | (B detects A)
        | <----------- UDP Unicast (USER_AVAILABLE) --------------- | (A detects B)
        |                                                           |
        | ========================================================= |
        |                 1. SECURE PAIRING HANDSHAKE               |
        | ========================================================= |
        |                                                           |
        | ---- Socket.IO Client Link (connection-request) --------> | (Shows pairing prompt)
        | <--- Socket.IO (connection-response Accepted) ----------- | (User clicks Accept)
        |                                                           |
        | ---- Socket.IO (ECDH Public Key A) ---------------------> |
        | <--- Socket.IO (ECDH Public Key B) ---------------------- |
        |   [Derives session key]                   [Derives session key]
        |                                                           |
        | ========================================================= |
        |                 2. ENCRYPTED P2P CHAT ACTIVE              |
        | ========================================================= |
        |                                                           |
        | ---- AES-256-GCM Msg -----------------------------------> | (Decrypted & shown)
        |                                                           |
        | ========================================================= |
        |                 3. RELIABLE UDP FILE SHARING              |
        | ========================================================= |
        |                                                           |
        | ---- Socket.IO (File request: size, hash) --------------> | (Shows file prompt)
        |                                                           |
        |                                    [Starts UDP Receiver on random port]
        | <--- Socket.IO (Accept, UDP Port: 45678) ---------------- | 
        |                                                           |
        | [Compresses file]                                         |
        | [Encrypts whole file]                                     |
        | ---- Socket.IO (AES IV/Tag metadata) -------------------> |
        |                                                           |
        | ---- UDP Data Packets (Sliding Window) -----------------> | [Buffers out-of-order]
        | <--- UDP Feedback Packets (ACK / SACK) ------------------ | [Slides expected pointer]
        |                                                           |
        | ---- UDP FIN Packet ------------------------------------> | 
        |                                                           | [Decrypts & decompress]
        |                                                           | [Verifies SHA-256 hash]
        |                                                           | [Saves to Downloads]
```

### Protocol Details & Congestion Scaling

* **Sliding Window**: The sender transmits up to `cwnd` packets before requiring ACKs. `cwnd` starts at `1` packet.
* **Slow Start**: For every successful ACK, `cwnd` increases by `1.0`. The window size doubles every RTT.
* **Congestion Avoidance**: Once `cwnd` reaches the threshold (`ssthresh`), it increases linearly by `1.0 / cwnd` per ACK to safely explore network capacity.
* **Packet Loss Adjustment**: If a packet timeout occurs (no ACK received within RTO):
  * `ssthresh` is cut in half: `ssthresh = max(2, cwnd / 2)`
  * The window is reset to `1`: `cwnd = 1.0`
  * The sender falls back into Slow Start.
* **Selective ACKs (SACK)**: The receiver tracks out-of-order packets and includes them in the ACK feedback payload. This allows the sender to *only* retransmit missing chunks, minimizing unnecessary network load.