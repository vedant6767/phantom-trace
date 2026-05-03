const express = require("express");
const crypto  = require("crypto");
const path    = require("path");

const app = express();
app.use(express.json());

// Works both locally (backend/) and on Render (repo root)
const DIST = path.join(__dirname, "../frontend/dist");
const FILES_DIR = path.join(__dirname, "../files");
app.use(express.static(DIST));

// ═══════════════════════════════════════════════════════════════════════════════
// SESSION STORE
// ═══════════════════════════════════════════════════════════════════════════════
const sessions = {};

function getSession(sid) {
  if (!sessions[sid]) {
    // Every player gets unique crypto material — nothing is shared
    const salt      = crypto.randomBytes(16).toString("hex");
    const xorKey    = (crypto.randomBytes(1)[0] % 200) + 20;   // 20–219
    const rotShift  = (crypto.randomBytes(1)[0] % 23)  + 3;    // 3–25
    const fxorKey   = (crypto.randomBytes(1)[0] % 200) + 20;   // forensics XOR key
    const pwnOffset = ((crypto.randomBytes(1)[0] % 200) + 50).toString(16); // hex offset
    const pwnMagic  = crypto.randomBytes(4).toString("hex");    // 8-char hex value

    sessions[sid] = {
      salt, xorKey, rotShift, fxorKey, pwnOffset, pwnMagic,
      r_valid: false, p_valid: false, f_valid: false,
      wrongAttempts: 0,
      sequence: [],
      createdAt: Date.now(),
      // Lying flag: 30% chance analyze() will lie about one layer
      lieLayer: Math.random() < 0.3 ? ["rev","pwn","forensics"][Math.floor(Math.random()*3)] : null,
    };
  }
  return sessions[sid];
}

// ═══════════════════════════════════════════════════════════════════════════════
// CRYPTO HELPERS
// ═══════════════════════════════════════════════════════════════════════════════
function rot(str, n) {
  return str.replace(/[a-zA-Z]/g, c => {
    const base = c <= "Z" ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + n) % 26) + base);
  });
}

function xorBuf(buf, key) {
  return Buffer.from(buf.map(b => b ^ key));
}

// Base85 (RFC 1924 alphabet)
const B85 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&()*+-;<=>?@^_`{|}~";
function encodeB85(buf) {
  let out = "";
  for (let i = 0; i < buf.length; i += 4) {
    let n = 0, len = Math.min(4, buf.length - i);
    for (let j = 0; j < 4; j++) n = n * 256 + (j < len ? buf[i+j] : 0);
    const enc = [];
    for (let j = 0; j < 5; j++) { enc.unshift(B85[n % 85]); n = Math.floor(n / 85); }
    out += enc.slice(0, len + 1).join("");
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════════
// FRAGMENT DERIVATION  (all session-specific)
// ═══════════════════════════════════════════════════════════════════════════════
// REV:  plaintext = "phantom_rev_core"
//       encode:  rot(plain, rotShift) → XOR(xorKey) → Base64
//       answer:  SHA1("phantom_rev_core" + salt)
//
// PWN:  payload = pwnOffset|pwnMagic|HMAC(salt,"pwn_gate")[:8]
//       answer:  HMAC-SHA256(salt, "pwn_core")[:32]
//
// FORENSICS: plaintext = "forensic_seed"
//       encode: encodeB85(plain) → XOR(fxorKey) → Base64
//       answer: SHA1("forensic_seed" + salt).slice(-32)
//
// FINAL: SHA256(part1 + part2 + part3 + salt)

const REV_PLAIN = "phantom_rev_core";
const FOR_PLAIN = "forensic_seed";

function part1(s)  { return crypto.createHash("sha1").update(REV_PLAIN + s.salt).digest("hex"); }
function part2(s)  { return crypto.createHmac("sha256", s.salt).update("pwn_core").digest("hex").slice(0,32); }
function part3(s)  { return crypto.createHash("sha1").update(FOR_PLAIN + s.salt).digest("hex").slice(-32); }
function finalHash(s) {
  return crypto.createHash("sha256").update(part1(s)+part2(s)+part3(s)+s.salt).digest("hex");
}
function pwnGateKey(s) {
  return crypto.createHmac("sha256", s.salt).update("pwn_gate").digest("hex").slice(0,8);
}

// Per-session encoded REV blob (what goes in rev_encoded.txt)
function encodeRevBlob(s) {
  const step1 = rot(REV_PLAIN, s.rotShift);
  const step2 = xorBuf(Buffer.from(step1), s.xorKey);
  return step2.toString("base64");
}

// Per-session encoded FORENSICS blob
function encodeForBlob(s) {
  const step1 = encodeB85(Buffer.from(FOR_PLAIN));
  const step2 = xorBuf(Buffer.from(step1), s.fxorKey);
  return step2.toString("base64");
}

// ═══════════════════════════════════════════════════════════════════════════════
// FAKE FLAGS
// ═══════════════════════════════════════════════════════════════════════════════
const FAKES = [
  "flag{Try_Harder_baby_;)}",
  "flag{s0_cl0se_yet_s0_far}",
  "flag{n0t_th1s_t1me_fr1end}",
  "flag{alm0st_but_n0t_qu1te}",
  "flag{d3coy_activated_g00d_try}",
  "flag{y0u_f0und_th3_wr0ng_path}",
  "flag{k33p_d1gg1ng_h4ck3r}",
];
const fake = () => FAKES[crypto.randomBytes(1)[0] % FAKES.length];

// ═══════════════════════════════════════════════════════════════════════════════
// ANTI-BRUTEFORCE  (wrong attempts only)
// ═══════════════════════════════════════════════════════════════════════════════
function wrongDelay(n) {
  if (n < 8)  return 0;
  if (n < 20) return Math.min(2 ** (n - 7) * 80, 8000);
  return null; // fake success
}

// ═══════════════════════════════════════════════════════════════════════════════
// MIDDLEWARE
// ═══════════════════════════════════════════════════════════════════════════════
app.use("/api", (req, res, next) => {
  const sid = req.headers["x-session-id"];
  if (!sid || sid.length < 16) return res.status(400).json({ msg: "Handshake failed.", status: "fail" });
  req.session = getSession(sid);
  next();
});

// ═══════════════════════════════════════════════════════════════════════════════
// DECOY ENDPOINTS  — look real, always return fake flags
// ═══════════════════════════════════════════════════════════════════════════════
app.post("/api/admin",    (_, res) => res.json({ msg: fake(), status: "ok", token: crypto.randomBytes(8).toString("hex") }));
app.post("/api/shortcut", (_, res) => res.json({ msg: fake(), status: "ok" }));
app.post("/api/bypass",   (_, res) => res.json({ msg: fake(), status: "ok" }));
app.get("/api/scoreboard",(_, res) => res.json({ top: [{ user:"h4x0r_1337", score:9999, flag: fake() }] }));
app.get("/api/hint",      (_, res) => res.json({ hint: "The answer is closer than you think.", flag: fake() }));
// Fake "debug" endpoint that looks like it leaks info
app.get("/api/debug", (req, res) => {
  const s = req.session;
  res.json({
    session: req.headers["x-session-id"]?.slice(0,8) + "...",
    salt: crypto.randomBytes(16).toString("hex"),   // FAKE salt
    xorKey: (crypto.randomBytes(1)[0] % 200) + 20, // FAKE key
    flag: fake(),
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CHALLENGE FILE ENDPOINT  — per-session, generated on demand
// ═══════════════════════════════════════════════════════════════════════════════
app.get("/api/files/:name", (req, res) => {
  const s   = req.session;
  const name = req.params.name;

  if (name === "rev_encoded.txt") {
    const real = encodeRevBlob(s);
    // 6 fake blobs + 1 real, shuffled, no labels
    const blobs = [
      real,
      ...Array.from({length:6}, () => crypto.randomBytes(12).toString("base64")),
    ].sort(() => Math.random() - 0.5);

    const noise = () => crypto.randomBytes(8).toString("hex");
    const content = `=== SIGNAL INTERCEPT :: NODE-${noise().slice(0,4).toUpperCase()} ===
Capture timestamp: ${Date.now() - Math.floor(Math.random()*9999999)}
Integrity: ${noise()}

[STREAM FRAGMENTS]
${blobs.map((b,i) => `  FRAG_${String(i).padStart(2,"0")}: ${b}`).join("\n")}

[METADATA]
  proto_ver: 0x${noise().slice(0,4)}
  checksum:  ${noise()}
  reserved:  ${noise()}

[NOISE]
${Array.from({length:8}, () => `  ${noise()}: ${crypto.randomBytes(16).toString("base64")}`).join("\n")}
`;
    res.type("text/plain").send(content);
    return;
  }

  if (name === "forensic_dump.mem") {
    const real = encodeForBlob(s);
    // 4 fake LAYER_DATA lines + 1 real; real one has a valid CRC32-style marker
    const realCrc = crypto.createHash("sha256").update(real + s.salt).digest("hex").slice(0,8);
    const fakeEntries = Array.from({length:4}, () => ({
      data: crypto.randomBytes(18).toString("base64"),
      crc:  crypto.randomBytes(4).toString("hex"),
    }));
    const allEntries = [
      ...fakeEntries,
      { data: real, crc: realCrc },
    ].sort(() => Math.random() - 0.5);

    const noise = () => crypto.randomBytes(8).toString("hex");
    const content = `=== PHANTOM TRACE :: MEMORY ACQUISITION ===
Acquisition: ${new Date().toISOString()}
Host: phantom-node-${noise().slice(0,4)}
Kernel: 5.15.0-phantom-${noise().slice(0,3)}

[PROCESS TABLE]
  PID 1    systemd
  PID 412  phantom_svc
  PID 413  auth_monitor  [PROTECTED]
  PID 881  mem_watcher
  PID 999  [REDACTED]

[NETWORK ARTIFACTS]
  ${noise()} → ${noise()}
  ${noise()} → ${noise()}

[ENCODED ARTIFACTS]
${allEntries.map((e,i) => `  LAYER_${String(i).padStart(2,"0")}: ${e.data}  [crc:${e.crc}]`).join("\n")}

[EXIF REMNANTS]
  GPS: ${(Math.random()*180-90).toFixed(4)}° N, ${(Math.random()*360-180).toFixed(4)}° W
  Device: PHANTOM-CAM-X${Math.floor(Math.random()*9)+1}
  Comment: ${noise()}

[DECOY FLAGS]
  ${fake()}
  ${fake()}

[CHECKSUM]
  ${crypto.randomBytes(32).toString("hex")}
`;
    res.type("text/plain").send(content);
    return;
  }

  if (name === "decoy_data.log") {
    const lines = Array.from({length:60}, (_,i) =>
      `[${new Date(Date.now()-i*60000).toISOString()}] ${
        ["AUTH_FAIL","SCAN","PROBE","CONNECT","RESET"][i%5]
      } src=${Array.from({length:4},()=>Math.floor(Math.random()*256)).join(".")} flag=${fake()}`
    ).join("\n");
    res.type("text/plain").send(lines);
    return;
  }

  res.status(404).send("Not found");
});

// ═══════════════════════════════════════════════════════════════════════════════
// REV ENDPOINT
// ═══════════════════════════════════════════════════════════════════════════════
app.post("/api/rev", (req, res) => {
  const s     = req.session;
  const input = (req.body.data || "").trim();

  if (input.startsWith("flag{") || input.startsWith("HW{"))
    return res.json({ msg: "Signal rejected.", status: "fail" });

  if (input === part1(s)) {
    if (!s.sequence.includes("rev")) s.sequence.push("rev");
    s.r_valid = true;
    return res.json({ msg: "R: accepted.", status: "ok" });
  }

  // Almost-correct bait
  if (input.length === 40 && input.startsWith(part1(s).slice(0,6)))
    return res.json({ msg: "Partial match. Layer mismatch.", status: "fail" });

  s.wrongAttempts++;
  const delay = wrongDelay(s.wrongAttempts);
  if (delay === null) return res.json({ msg: fake(), status: "ok" });
  setTimeout(() => res.json({ msg: "Invalid.", status: "fail" }), delay);
});

// ═══════════════════════════════════════════════════════════════════════════════
// PWN ENDPOINT
// ═══════════════════════════════════════════════════════════════════════════════
app.post("/api/pwn", (req, res) => {
  const s       = req.session;
  const payload = (req.body.data || "").trim();

  if (!s.r_valid)
    return res.json({ msg: "Bus offline.", status: "fail" });

  const parts = payload.split("|");
  if (parts.length !== 3)
    return res.json({ msg: "Rejected.", status: "fail", dump: fakeDump(s) });

  const [offset, value, key] = parts;
  const goodKey = pwnGateKey(s);

  // Correct
  if (offset === s.pwnOffset && value === s.pwnMagic && key === goodKey) {
    if (!s.sequence.includes("pwn")) s.sequence.push("pwn");
    s.p_valid = true;
    return res.json({ msg: "Redirected.", status: "ok", data: part2(s) });
  }

  // Fake win: right offset+value, wrong key
  if (offset === s.pwnOffset && value === s.pwnMagic)
    return res.json({ msg: fake(), status: "ok", note: "core dumped" });

  s.wrongAttempts++;
  const delay = wrongDelay(s.wrongAttempts);
  if (delay === null) return res.json({ msg: fake(), status: "ok" });
  setTimeout(() => res.json({ msg: "Fault.", status: "fail", dump: fakeDump(s) }), delay);
});

function fakeDump(s) {
  // Dump contains the real pwnOffset and pwnMagic buried in noise — that's the only hint
  const lines = [];
  const insertAt = Math.floor(Math.random() * 5);
  for (let i = 0; i < 8; i++) {
    if (i === insertAt)
      lines.push(`0x${s.pwnOffset}: ${s.pwnMagic}${crypto.randomBytes(4).toString("hex")}`);
    else
      lines.push(`0x${(parseInt(s.pwnOffset,16)+i*4).toString(16)}: ${crypto.randomBytes(8).toString("hex")}`);
  }
  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════════
// FORENSICS ENDPOINT
// ═══════════════════════════════════════════════════════════════════════════════
app.post("/api/forensics", (req, res) => {
  const s     = req.session;
  const input = (req.body.data || "").trim();

  if (!s.p_valid)
    return res.json({ msg: "Node locked.", status: "fail" });

  if (input === part3(s)) {
    if (!s.sequence.includes("forensics")) s.sequence.push("forensics");
    s.f_valid = true;
    return res.json({ msg: "F: accepted.", status: "ok" });
  }

  if (input === FOR_PLAIN)
    return res.json({ msg: fake(), status: "ok" });

  s.wrongAttempts++;
  const delay = wrongDelay(s.wrongAttempts);
  if (delay === null) return res.json({ msg: fake(), status: "ok" });
  setTimeout(() => res.json({ msg: "Mismatch.", status: "fail" }), delay);
});

// ═══════════════════════════════════════════════════════════════════════════════
// FINAL ENDPOINT
// ═══════════════════════════════════════════════════════════════════════════════
app.post("/api/final", (req, res) => {
  const s     = req.session;
  const input = (req.body.data || "").trim();

  if (!s.r_valid || !s.p_valid || !s.f_valid)
    return res.json({ msg: "Fragments incomplete.", status: "fail" });

  // Must have solved in order
  const order = ["rev","pwn","forensics"];
  if (!order.every((v,i) => s.sequence[i] === v))
    return res.json({ msg: fake(), status: "ok" });

  if (input === finalHash(s))
    return res.json({ msg: "HW{--Well done Babes-- ;) }", status: "ok" });

  s.wrongAttempts++;
  const delay = wrongDelay(s.wrongAttempts);
  if (delay === null) return res.json({ msg: fake(), status: "ok" });
  setTimeout(() => res.json({ msg: fake(), status: "ok" }), delay); // final always returns fake on wrong
});

// ═══════════════════════════════════════════════════════════════════════════════
// STATUS ENDPOINT  — sometimes lies
// ═══════════════════════════════════════════════════════════════════════════════
app.get("/api/status", (req, res) => {
  const s = req.session;
  const real = {
    rev:       s.r_valid ? "CLEARED" : "LOCKED",
    pwn:       s.p_valid ? "CLEARED" : "LOCKED",
    forensics: s.f_valid ? "CLEARED" : "LOCKED",
  };

  // 30% chance one layer status is inverted (lie)
  const lied = { ...real };
  if (s.lieLayer && Math.random() < 0.3) {
    lied[s.lieLayer] = lied[s.lieLayer] === "CLEARED" ? "LOCKED" : "CLEARED";
  }

  res.json({
    layers:    lied,
    fragments: [s.r_valid, s.p_valid, s.f_valid].filter(Boolean).length,
    noise:     crypto.randomBytes(8).toString("hex"),
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// STATIC FILES  (old /files/ path kept for compatibility)
// ═══════════════════════════════════════════════════════════════════════════════
app.get("/files/:name", (req, res) => res.redirect(`/api/files/${req.params.name}`));

app.get("*", (_, res) =>
  res.sendFile(path.join(DIST, "index.html"))
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`PHANTOM TRACE :: ELITE running on :${PORT}`));
