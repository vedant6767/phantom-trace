# PHANTOM TRACE ELITE — Operator Solution Guide

## What changed (hard mode)

- All encoding keys are **random per session** — no two players have the same puzzle
- Challenge files are **generated on demand** per session (hit `/api/files/` with your session header)
- `analyze` **lies** 30% of the time about one layer's status
- PWN offset and magic value are **random per session** — buried in the memory dump
- Forensics has **5 LAYER_DATA lines**, only one is real (identified by valid CRC)
- Final wrong answers **always return a fake flag** (never "wrong hash" message)
- No hints anywhere in the UI

---

## Layer 1 — REV

**File:** `GET /api/files/rev_encoded.txt` (with X-Session-ID header)

Find the correct `FRAG_XX` line. There are 7 fragments, only 1 is real.
The real one decodes correctly through the chain:

```
Base64 decode → XOR(xorKey) → ROT(rotShift) → "phantom_rev_core"
```

`xorKey` is 20–219, `rotShift` is 3–25. You must brute-force both (200×23 = 4,600 combinations).

Then compute:
```
part1 = SHA1("phantom_rev_core" + SESSION_ID)
```

Submit: `submit <part1>`

---

## Layer 2 — PWN (REV must be cleared first)

**No file needed.** The memory dump is returned on wrong payloads.

Payload format: `OFFSET|VALUE|KEY`

- `OFFSET` and `VALUE` are buried in the dump output on wrong attempts
  - Look for the line where VALUE is exactly 8 hex chars (not 16)
- `KEY` = `HMAC-SHA256(SESSION_ID, "pwn_gate").slice(0, 8)`

```js
const crypto = require("crypto");
const key = crypto.createHmac("sha256", SESSION_ID).update("pwn_gate").digest("hex").slice(0, 8);
```

Inject: `inject <offset>|<magic>|<key>`

The response contains `data:` — that is **part2**. Save it.

---

## Layer 3 — FORENSICS (PWN must be cleared first)

**File:** `GET /api/files/forensic_dump.mem` (with X-Session-ID header)

Find the real `LAYER_XX` entry. Each has a `[crc:XXXXXXXX]` tag.
The real one's CRC = `SHA256(layer_data + SESSION_ID).slice(0, 8)`.

Check all 5 entries:
```js
const real = entries.find(e =>
  crypto.createHash("sha256").update(e.data + SESSION_ID).digest("hex").slice(0,8) === e.crc
);
```

Decode the real entry:
```
Base64 decode → XOR(fxorKey) → Base85 decode → "forensic_seed"
```

`fxorKey` is 20–219. Brute-force it (200 combinations).

Then compute:
```
part3 = SHA1("forensic_seed" + SESSION_ID).slice(-32)
```

Submit: `submit <part3>`

---

## Final Flag

Must solve in order: rev → pwn → forensics.

```
final_hash = SHA256(part1 + part2 + part3 + SESSION_ID)
```

Submit: `submit final <final_hash>`

Correct → `HW{--Well done Babes-- ;) }`
Wrong → always returns a fake flag (no error message)

---

## Trap Summary

| Trap | Effect |
|------|--------|
| 7 FRAG lines in rev file | Must brute-force to find real one |
| 5 LAYER lines in forensics | Must verify CRC to find real one |
| `analyze` lies 30% of the time | Can't trust status output |
| PWN fake win (right offset/magic, wrong key) | Returns fake flag |
| >20 wrong attempts | Returns fake success forever |
| `/api/debug` endpoint | Returns fake salt/key |
| `/api/hint` endpoint | Returns fake flag |
| Final wrong answer | Always fake flag, never error |
| Out-of-order solve | Fake flag on final |
