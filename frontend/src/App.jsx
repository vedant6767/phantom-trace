import { useState, useEffect, useRef, useCallback } from "react";
import MatrixRain from "./MatrixRain";
import Terminal from "./Terminal";

function getSessionId() {
  let sid = sessionStorage.getItem("phantom_sid");
  if (!sid) {
    sid = Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map(b => b.toString(16).padStart(2,"0"))
      .join("");
    sessionStorage.setItem("phantom_sid", sid);
  }
  return sid;
}

const SID = getSessionId();

// Misleading boot messages shown on load
const BOOT_LINES = [
  { text: "PHANTOM TRACE :: ELITE v2.3.1", type: "banner" },
  { text: `Node ID: ${crypto.randomUUID().slice(0,13).toUpperCase()}`, type: "syslog" },
  { text: "Secure channel: ESTABLISHED", type: "syslog" },
  { text: "Fragment cache: WARM", type: "syslog" },        // lie — cache is empty
  { text: "Auth module: ONLINE", type: "syslog" },
  { text: "Watchdog: ACTIVE", type: "syslog" },
  { text: "", type: "blank" },
  { text: 'Type "help" to begin.', type: "info" },
  { text: "", type: "blank" },
];

// Fake syslog lines — some are misleading on purpose
const SYSLOGS = [
  "SYS: Memory integrity check... OK",
  "SYS: Watchdog timer reset",
  "SYS: Intrusion detection active",
  "WARN: Anomalous probe on port 9002",       // decoy port hint
  "INFO: Session token rotated",
  "WARN: Fragment cache invalidated",          // lie
  "SYS: Auth module heartbeat",
  "INFO: Entropy pool refreshed",
  "WARN: Replay attack detected — blocked",
  "SYS: Packet filter updated",
  "INFO: REV layer: signal degraded",          // misleading
  "WARN: PWN layer: stack canary active",      // misleading — no real canary
  "INFO: Forensic node: checksum mismatch",    // misleading
  "SYS: Decoy nodes responding normally",
];

export default function App() {
  const [lines, setLines]       = useState(BOOT_LINES);
  const [status, setStatus]     = useState({ rev:"LOCKED", pwn:"LOCKED", forensics:"LOCKED", fragments:0 });
  const [activeLayer, setLayer] = useState(null);
  const [waiting, setWaiting]   = useState(false);

  const push  = useCallback((text, type="output") => setLines(p => [...p, { text, type }]), []);
  const pushN = useCallback((arr) => setLines(p => [...p, ...arr]), []);

  // Fake syslog ticker
  useEffect(() => {
    let i = Math.floor(Math.random() * SYSLOGS.length);
    const id = setInterval(() => {
      push(SYSLOGS[i % SYSLOGS.length], "syslog");
      i++;
    }, 18000 + Math.random() * 12000);
    return () => clearInterval(id);
  }, [push]);

  const api = useCallback(async (endpoint, body) => {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Session-ID": SID },
      body: JSON.stringify(body),
    });
    return res.json();
  }, []);

  const fetchStatus = useCallback(async () => {
    const res = await fetch("/api/status", { headers: { "X-Session-ID": SID } });
    const d   = await res.json();
    if (d.layers) setStatus({ ...d.layers, fragments: d.fragments });
    return d;
  }, []);

  const handle = useCallback(async (raw) => {
    const cmd = raw.trim().toLowerCase();
    push(`> ${raw}`, "input");
    if (!cmd) return;

    // ── help ────────────────────────────────────────────────────────────────
    if (cmd === "help") {
      pushN([
        { text: "Commands:", type: "info" },
        { text: "  connect <layer>      — connect rev | pwn | forensics", type: "output" },
        { text: "  analyze              — query layer status", type: "output" },
        { text: "  inject <payload>     — send payload to active layer", type: "output" },
        { text: "  submit <value>       — submit fragment answer", type: "output" },
        { text: "  submit final <hash>  — submit final hash", type: "output" },
        { text: "  files                — list challenge files", type: "output" },
        { text: "  clear                — clear terminal", type: "output" },
        { text: "", type: "blank" },
      ]);
      return;
    }

    // ── clear ───────────────────────────────────────────────────────────────
    if (cmd === "clear") { setLines([{ text: "—", type: "syslog" }]); return; }

    // ── files ───────────────────────────────────────────────────────────────
    if (cmd === "files") {
      pushN([
        { text: "Challenge files (session-bound):", type: "info" },
        { text: `  /api/files/rev_encoded.txt`, type: "output" },
        { text: `  /api/files/forensic_dump.mem`, type: "output" },
        { text: `  /api/files/decoy_data.log`, type: "output" },
        { text: "  NOTE: Files are unique to your session.", type: "syslog" },
        { text: "", type: "blank" },
      ]);
      return;
    }

    // ── analyze ─────────────────────────────────────────────────────────────
    if (cmd === "analyze") {
      setWaiting(true);
      push("Querying...", "syslog");
      const d = await fetchStatus();
      pushN([
        { text: `  REV       : ${d.layers?.rev ?? "?"}`, type: d.layers?.rev === "CLEARED" ? "success" : "output" },
        { text: `  PWN       : ${d.layers?.pwn ?? "?"}`, type: d.layers?.pwn === "CLEARED" ? "success" : "output" },
        { text: `  FORENSICS : ${d.layers?.forensics ?? "?"}`, type: d.layers?.forensics === "CLEARED" ? "success" : "output" },
        { text: `  Fragments : ${d.fragments ?? 0}/3`, type: "info" },
        { text: "", type: "blank" },
      ]);
      setWaiting(false);
      return;
    }

    // ── connect <layer> ─────────────────────────────────────────────────────
    if (cmd.startsWith("connect ")) {
      const layer = cmd.split(" ")[1];
      if (!["rev","pwn","forensics"].includes(layer)) {
        push(`Unknown layer: ${layer}`, "error");
        return;
      }
      setLayer(layer);
      // No hints — just confirm connection
      pushN([
        { text: `${layer.toUpperCase()} layer connected.`, type: "success" },
        { text: `Download: /api/files/${layer === "forensics" ? "forensic_dump.mem" : "rev_encoded.txt"}`, type: layer === "pwn" ? "syslog" : "output" },
        { text: "", type: "blank" },
      ]);
      return;
    }

    // ── inject <payload> ────────────────────────────────────────────────────
    if (cmd.startsWith("inject ")) {
      const payload = raw.slice(7).trim();
      if (activeLayer !== "pwn") { push("No PWN layer active.", "error"); return; }
      setWaiting(true);
      const d = await api("/api/pwn", { data: payload });
      push(d.msg, d.status === "ok" ? "success" : "error");
      if (d.dump) push(d.dump, "dump");
      if (d.data) {
        push(`data: ${d.data}`, "fragment");
      }
      if (d.status === "ok") await fetchStatus();
      setWaiting(false);
      return;
    }

    // ── submit final <hash> ──────────────────────────────────────────────────
    if (cmd.startsWith("submit final ")) {
      const hash = raw.slice(13).trim();
      setWaiting(true);
      const d = await api("/api/final", { data: hash });
      push(d.msg, d.status === "ok" ? "flag" : "error");
      setWaiting(false);
      return;
    }

    // ── submit <value> ───────────────────────────────────────────────────────
    if (cmd.startsWith("submit ")) {
      const value = raw.slice(7).trim();
      if (!activeLayer) { push("No layer active.", "error"); return; }
      setWaiting(true);
      const d = await api(`/api/${activeLayer}`, { data: value });
      push(d.msg, d.status === "ok" ? "success" : "error");
      if (d.status === "ok") await fetchStatus();
      setWaiting(false);
      return;
    }

    push(`Unknown command: ${cmd}`, "error");
  }, [activeLayer, api, fetchStatus, push, pushN]);

  return (
    <div style={{ position:"relative", width:"100vw", height:"100vh", background:"#000", overflow:"hidden" }}>
      <MatrixRain />
      <Terminal lines={lines} onCommand={handle} waiting={waiting} status={status} sessionId={SID} />
    </div>
  );
}
