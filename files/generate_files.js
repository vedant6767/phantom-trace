/**
 * Run once: node generate_files.js
 * Produces the three challenge files placed in /files/
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// ─── REV CHALLENGE ────────────────────────────────────────────────────────────
// Plain text: "phantom_rev_core"
// Encoding chain (forward): ROT13 → XOR(0x5A) → Base64
// Player must reverse: Base64 decode → XOR(0x5A) → ROT13 → get "phantom_rev_core"
// Then compute SHA1("phantom_rev_core" + their_session_salt) — but the salt is
// per-session, so the file gives them the ALGORITHM, not the final answer.

function rot13(str) {
  return str.replace(/[a-zA-Z]/g, (c) => {
    const base = c <= "Z" ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
  });
}

function xorBuf(buf, key) {
  return Buffer.from(buf.map((b) => b ^ key));
}

const plaintext = "phantom_rev_core";
const step1 = rot13(plaintext);                          // ROT13
const step2 = xorBuf(Buffer.from(step1), 0x5a);         // XOR 0x5A
const step3 = step2.toString("base64");                  // Base64

// Add noise lines around the real encoded blob
const noiseLines = [
  "INIT_SEQUENCE: " + crypto.randomBytes(12).toString("base64"),
  "CHECKSUM: " + crypto.randomBytes(8).toString("hex"),
  "PAYLOAD: " + step3,   // <-- real one
  "DECOY_A: " + Buffer.from(rot13("fake_flag_data")).toString("base64"),
  "DECOY_B: " + crypto.randomBytes(16).toString("base64"),
  "DECOY_C: " + Buffer.from("flag{Try_Harder_baby_;)}").toString("base64"),
  "TIMESTAMP: " + Date.now(),
];

const revContent = `=== PHANTOM TRACE :: REV MODULE ===
System boot sequence intercepted.
Encoding pipeline: [CLASSIFIED]

${noiseLines.join("\n")}

NOTE: Only one PAYLOAD line is authentic.
Decoding pipeline hint: reverse the standard transformation chain.
Final answer = SHA1(decoded_value + session_salt)
Session salt is transmitted in the X-Session-ID handshake.
`;

fs.writeFileSync(path.join(__dirname, "rev_encoded.txt"), revContent);
console.log("rev_encoded.txt written");
console.log("  Plaintext:", plaintext);
console.log("  Encoded (PAYLOAD line):", step3);

// ─── FORENSICS CHALLENGE ──────────────────────────────────────────────────────
// Hidden value: "forensic_seed"
// Layers: Base85 encode → XOR(0x2F) → Base64 → embed in noise
// Player must: Base64 decode → XOR(0x2F) → Base85 decode → "forensic_seed"
// Then compute SHA1("forensic_seed" + session_salt)[-32:]

// Node doesn't have built-in base85; we'll use a simple ascii85 variant
function encodeBase85(buf) {
  // Simple base85 (RFC 1924 alphabet)
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&()*+-;<=>?@^_`{|}~";
  let result = "";
  for (let i = 0; i < buf.length; i += 4) {
    let chunk = 0;
    const len = Math.min(4, buf.length - i);
    for (let j = 0; j < 4; j++) {
      chunk = chunk * 256 + (j < len ? buf[i + j] : 0);
    }
    const encoded = [];
    for (let j = 0; j < 5; j++) {
      encoded.unshift(chars[chunk % 85]);
      chunk = Math.floor(chunk / 85);
    }
    result += encoded.slice(0, len + 1).join("");
  }
  return result;
}

const forensicPlain = "forensic_seed";
const fStep1 = encodeBase85(Buffer.from(forensicPlain));   // Base85
const fStep2 = xorBuf(Buffer.from(fStep1), 0x2f);          // XOR 0x2F
const fStep3 = fStep2.toString("base64");                   // Base64

const forensicContent = `=== PHANTOM TRACE :: FORENSIC DUMP ===
Memory acquisition timestamp: ${new Date().toISOString()}
Acquisition tool: phantom_mem_acq v2.3.1

[BLOCK 0x00] METADATA
  host: phantom-node-07
  kernel: 5.15.0-phantom
  uptime: 847293s

[BLOCK 0x01] PROCESS TABLE (PARTIAL)
  PID 1    init
  PID 412  phantom_svc
  PID 413  auth_monitor
  PID 999  [REDACTED]

[BLOCK 0x02] NETWORK ARTIFACTS
  ${crypto.randomBytes(20).toString("hex")}
  ${crypto.randomBytes(20).toString("hex")}

[BLOCK 0x03] ENCODED ARTIFACT (MULTI-LAYER)
  LAYER_DATA: ${fStep3}
  DECOY_1: ${crypto.randomBytes(24).toString("base64")}
  DECOY_2: ${Buffer.from("flag{fake_forensic_path}").toString("base64")}
  DECOY_3: ${crypto.randomBytes(18).toString("base64")}

[BLOCK 0x04] EXIF REMNANTS
  GPS: 37.7749° N, 122.4194° W
  Device: PHANTOM-CAM-X1
  Comment: ${crypto.randomBytes(10).toString("hex")}

[BLOCK 0x05] STEGO HINT
  Transformation pipeline: B64 → XOR(0x2F) → B85 → plaintext
  Final answer = SHA1(plaintext + session_salt)[-32:]

[BLOCK 0xFF] CHECKSUM
  ${crypto.randomBytes(32).toString("hex")}
`;

fs.writeFileSync(path.join(__dirname, "forensic_dump.txt"), forensicContent);
console.log("forensic_dump.txt written");
console.log("  Plaintext:", forensicPlain);
console.log("  Encoded (LAYER_DATA):", fStep3);

// ─── DECOY LOG ────────────────────────────────────────────────────────────────
const decoyContent = Array.from({ length: 40 }, (_, i) =>
  `[${new Date(Date.now() - i * 60000).toISOString()}] ${
    ["AUTH_FAIL", "SCAN_DETECT", "PROBE", "CONNECT", "DISCONNECT"][i % 5]
  } src=${crypto.randomBytes(4).map((b) => b % 256).join(".")} flag=${fakeFlag()}`
).join("\n");

function fakeFlag() {
  const pool = [
    "flag{Try_Harder_baby_;)}",
    "flag{s0_cl0se_yet_s0_far}",
    "flag{n0t_th1s_t1me}",
  ];
  return pool[Math.floor(Math.random() * pool.length)];
}

fs.writeFileSync(path.join(__dirname, "decoy_data.log"), decoyContent);
console.log("decoy_data.log written");
