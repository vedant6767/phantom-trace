import { useEffect, useRef, useState } from "react";

const TYPE_STYLES = {
  banner:   { color: "#0ff", fontWeight: "bold", fontSize: "1.1em" },
  info:     { color: "#7ff" },
  output:   { color: "#0f0" },
  input:    { color: "#ff0" },
  error:    { color: "#f44" },
  success:  { color: "#0f0", fontWeight: "bold" },
  syslog:   { color: "#444", fontSize: "0.85em" },
  dump:     { color: "#888", fontFamily: "monospace", whiteSpace: "pre" },
  fragment: { color: "#f0f", fontWeight: "bold" },
  flag:     { color: "#ff0", fontWeight: "bold", fontSize: "1.2em", textShadow: "0 0 8px #ff0" },
  blank:    { color: "transparent" },
};

export default function Terminal({ lines, onCommand, waiting, status, sessionId }) {
  const [input, setInput] = useState("");
  const [history, setHistory] = useState([]);
  const [histIdx, setHistIdx] = useState(-1);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  const submit = () => {
    if (!input.trim() || waiting) return;
    setHistory((h) => [input, ...h]);
    setHistIdx(-1);
    onCommand(input);
    setInput("");
  };

  const onKey = (e) => {
    if (e.key === "Enter") { submit(); return; }
    if (e.key === "ArrowUp") {
      const idx = Math.min(histIdx + 1, history.length - 1);
      setHistIdx(idx);
      setInput(history[idx] ?? "");
      return;
    }
    if (e.key === "ArrowDown") {
      const idx = Math.max(histIdx - 1, -1);
      setHistIdx(idx);
      setInput(idx === -1 ? "" : history[idx]);
    }
  };

  const fragments = [status.rev, status.pwn, status.forensics].filter((v) => v === "CLEARED").length;

  return (
    <div
      onClick={() => inputRef.current?.focus()}
      style={{
        position: "absolute",
        top: 0, left: 0, right: 0, bottom: 0,
        display: "flex",
        flexDirection: "column",
        padding: "12px 16px",
        fontFamily: "'Courier New', monospace",
        fontSize: "13px",
        color: "#0f0",
        cursor: "text",
      }}
    >
      {/* Status bar */}
      <div style={{
        display: "flex",
        gap: "24px",
        borderBottom: "1px solid #1a1a1a",
        paddingBottom: "6px",
        marginBottom: "8px",
        color: "#555",
        fontSize: "11px",
      }}>
        <span style={{ color: "#0ff" }}>PHANTOM TRACE</span>
        {["rev", "pwn", "forensics"].map((k) => (
          <span key={k} style={{ color: status[k] === "CLEARED" ? "#0f0" : "#333" }}>
            [{k.toUpperCase()}: {status[k] ?? "LOCKED"}]
          </span>
        ))}
        <span style={{ color: fragments === 3 ? "#ff0" : "#555" }}>
          FRAGMENTS: {fragments}/3
        </span>
        <span style={{ marginLeft: "auto", color: "#222" }}>
          SID: {sessionId.slice(0, 8)}…
        </span>
      </div>

      {/* Output area */}
      <div style={{ flex: 1, overflowY: "auto", paddingRight: "4px" }}>
        {lines.map((line, i) => (
          <div key={i} style={{ ...TYPE_STYLES[line.type] ?? TYPE_STYLES.output, lineHeight: "1.5" }}>
            {line.text || "\u00a0"}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input row */}
      <div style={{
        display: "flex",
        alignItems: "center",
        borderTop: "1px solid #1a1a1a",
        paddingTop: "6px",
        marginTop: "4px",
      }}>
        <span style={{ color: "#0ff", marginRight: "8px" }}>
          {waiting ? "⟳" : "▶"}
        </span>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
          disabled={waiting}
          autoFocus
          spellCheck={false}
          style={{
            flex: 1,
            background: "transparent",
            border: "none",
            outline: "none",
            color: "#ff0",
            fontFamily: "inherit",
            fontSize: "inherit",
            caretColor: "#0ff",
          }}
          placeholder={waiting ? "processing..." : "enter command"}
        />
      </div>
    </div>
  );
}
