# Codebase Hardening — Remaining Issues

> Generated from full codebase analysis (2026-03-31, 5 parallel scientist agents)
> Top 5 issues already fixed in prior commit.

## Status Legend
- [ ] TODO
- [x] DONE
- [-] WONTFIX

---

## MEDIUM Priority

### 7. Permission race condition
- **Location:** `server.js:200-276`
- **Problem:** Two rapid permission requests for the same session — first `respondFn` auto-denied at line 208, but second request can overwrite `session.prompt` before first response completes.
- **Fix:** Nullify `respondFn` before calling auto-deny to prevent double-call. Node.js single-threaded model prevents true race; existing auto-deny logic is correct.
- **Status:** [x] DONE — nullify-first pattern + clarifying comment

### 8. No authentication on `/api/shutdown`
- **Location:** `server.js:47`
- **Problem:** Any local process can POST to `/api/shutdown` and kill the bridge. Localhost-only mitigates risk.
- **Fix:** N/A — localhost-only API, auth token adds friction without meaningful security benefit.
- **Status:** [-] WONTFIX

### 9. Duplicate `package.json`
- **Location:** root `package.json` + `claude-plugin/package.json`
- **Problem:** Both declare identical dependencies (express, ws). Version drift risk when updating only one.
- **Fix:** N/A — dual package.json is by design (plugin distribution requires standalone package.json). `bump-version.js` syncs versions. Only 2 deps that rarely change.
- **Status:** [-] WONTFIX — accepted design

### 10. No structured logging
- **Location:** `logger.js`
- **Problem:** Human-readable text only. No JSON logging for automated analysis (error rates, latency percentiles).
- **Fix:** Added `CLAUDE_DJ_LOG_FORMAT=json` env var — outputs `{"ts","level","msg"}` to both console and file.
- **Status:** [x] DONE

---

## LOW Priority

### 11. `innerHTML` for i18n
- **Location:** `index.html:1244,1259`
- **Problem:** Uses `innerHTML` for translation strings. Currently safe (hardcoded), but fragile if dynamic data is introduced.
- **Fix:** N/A — all innerHTML sources are hardcoded i18n strings, no user data flows in.
- **Status:** [-] WONTFIX — no actual risk

### 12. No rate limiting
- **Location:** `server.js`
- **Problem:** No hook flood protection. Runaway hook could saturate the bridge.
- **Fix:** Added per-session sliding window rate limiter (100 req/s, 1s window). Returns 429 on excess.
- **Status:** [x] DONE

### 13. `cycleFocus` Map iteration order
- **Location:** `sessionManager.js:262-274`
- **Problem:** Relies on Map insertion order. Adding/removing sessions changes cycle order unpredictably.
- **Fix:** Sort by `startedAt` timestamp for deterministic cycling.
- **Status:** [x] DONE

### 14. Set serialization fragility
- **Location:** `sessionManager.js:362`
- **Problem:** Only `prompt.selected` Set is converted to Array in `toJSON`. Future Set fields would silently become `{}`.
- **Fix:** Generic Set→Array conversion for all prompt fields via `Object.entries` loop.
- **Status:** [x] DONE

### 15. No ESLint/Biome config
- **Location:** repo root
- **Problem:** Style consistency maintained by convention only. No automated enforcement.
- **Fix:** N/A — small codebase (~2,200 LOC) with consistent conventions. Tooling overhead not justified.
- **Status:** [-] WONTFIX

### 16. `CLAUDE_DJ_SHUTDOWN_TICKS` still uses `parseInt || default`
- **Location:** `server.js:383`
- **Problem:** Missed during config fix — still uses old `parseInt(...) || 10` pattern instead of `intEnv()`.
- **Fix:** Inlined `Number.isNaN` check consistent with `config.js` pattern.
- **Status:** [x] DONE

---

## Test Coverage Gaps

### 17. `wsServer.js` — no unit tests
- **Current:** Tested indirectly via integration (server.js E2E)
- **Needed:** Disconnect handling, message queuing, broadcast isolation

### 18. `logger.js` — no tests
- **Current:** Zero coverage
- **Needed:** Log levels, file rotation, debug mode toggle

### 19. `cli/index.js` — no tests
- **Current:** Zero coverage
- **Needed:** `stop` command, error cases, port parsing

### 20. `sessionStart.js` hook — no tests
- **Current:** Zero coverage
- **Needed:** boot-bridge integration, idempotency

### 21. `boot-bridge.js` hook — no tests
- **Current:** Zero coverage
- **Needed:** Process spawn logic, port conflict handling

### 22. Hook scripts — no unit tests
- **Current:** E2E spawn only (44 tests)
- **Needed:** Individual function-level tests for each hook

---

## Execution Order (recommended)

1. **#16** — SHUTDOWN_TICKS parseInt fix (trivial, consistency)
2. **#7** — Permission race condition (correctness bug)
3. **#9** — Duplicate package.json (maintenance)
4. **#8** — Shutdown auth token (security)
5. **#14** — Set serialization (robustness)
6. **#13** — cycleFocus ordering (predictability)
7. **#11** — innerHTML safety (defensive)
8. Rest as needed
