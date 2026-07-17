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
├── main.js                  # Electron main process (spawns backend & browser window)
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

## 📋 Prerequisites & Requirements

Before setting up and running the application, make sure you have the following installed on your system:

### 1. Node.js (v18.x or v20.x recommended)
The application requires the Node.js runtime environment to execute both the Express/Socket.IO backend server and the Electron container wrapper.
* **Windows & macOS**: Download the LTS installer directly from the [Official Node.js Downloads page](https://nodejs.org/en/download). Follow the standard installation wizard instructions.
* Verify your installation by running the following commands in your terminal/PowerShell:
  ```bash
  node -v
  npm -v
  ```

### 2. Git
To clone the repository and manage your codebase, you should have Git installed.
* **Windows**: Download and install from [Git for Windows](https://git-scm.com/download/win).
* **macOS**: Install using Homebrew (`brew install git`) or install Xcode Command Line Tools by running `xcode-select --install` in the terminal.

---

## ⚙️ A-Z Installation & Setup Guide

Follow these steps to set up the dependencies and configure the workspace from scratch.

### Step 1: Clone the Repository
Open your terminal (macOS/Linux) or PowerShell (Windows) and clone the repository:
```bash
git clone https://github.com/Rishav-09/UDP_BASED_FILESHARE.git
cd UDP_BASED_FILESHARE
```

### Step 2: Install All Dependencies
The project is organized as a monorepo-style structure, containing root dependencies (for Electron and developer tooling) and client-specific React dependencies. 

To make setup straightforward, a helper command is configured in the root `package.json` to install both:
```bash
npm run install:all
```

> [!NOTE]
> If you prefer to install packages manually or if the helper script fails, run:
> ```bash
> # 1. Install root dependencies (Electron, concurrently, etc.)
> npm install
> 
> # 2. Install React frontend dependencies
> cd client
> npm install
> cd ..
> ```

---

## 🚀 How to Run the Application

You can run the application in either **Development Mode** (with hot-reloading for UI updates) or **Production Mode** (standalone compiled bundle).

### Option 1: Running in Development Mode (Recommended)

In development mode, Vite serves the React UI on `http://localhost:5173`, and Electron hooks into this address while also spawning the local UDP/Socket.IO P2P node.

1. Start all components concurrently:
   ```bash
   npm run dev:all
   ```
2. Alternatively, you can run them manually in separate terminal tabs:
   * **Tab 1 (React Frontend)**:
     ```bash
     cd client
     npm run dev
     ```
   * **Tab 2 (Electron & Local Server)**:
     ```bash
     npm start
     ```

* **Windows Quick-Start**: Double-click the `start.bat` file in the root directory to automatically execute `npm run dev:all`.

---

### Option 2: Running in Production Mode (Pre-compiled Static Bundle)

For optimum performance or when deploying to target LAN machines, compile the frontend into a static bundle.

1. **Build the React frontend client**:
   ```bash
   cd client
   npm run build
   cd ..
   ```
   *This generates a compiled, optimized bundle inside `client/dist/`.*

2. **Launch Electron loading the production build**:
   ```bash
   npm start
   ```
   *Electron will automatically detect that Vite is not serving, or it will load `client/dist/index.html` as fallback.*

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

---

## 🛠️ Troubleshooting

### 1. Port Already In Use (`EADDRINUSE`)
If you receive an error saying port `41234`, `41235`, or another port is already in use:
* A background instance of the application might still be running.
* **Windows**: Run `taskkill /F /IM node.exe` and `taskkill /F /IM electron.exe` in Command Prompt.
* **macOS**: Run `killall node` and `killall Electron` in the Terminal.

### 2. Peers Not Discovering Each Other
* Ensure both devices are connected to the **same** local network / Wi-Fi subnet.
* Check your Firewall settings:
  * **Windows**: Ensure that both Node.js and Electron are allowed through Windows Defender Firewall for Private Networks.
  * **macOS**: Check System Settings -> Network -> Firewall and ensure incoming connections are not fully blocked.
* Make sure multicast/broadcast is not disabled by your router configuration (some corporate and public Wi-Fi networks block multicast and broadcast traffic).