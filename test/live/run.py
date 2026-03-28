"""
claude-dj Live Integration Test (Interactive Mode)
====================================================
Launches Claude CLI in a separate terminal window so PermissionRequest
hooks fire normally. Monitors Bridge API to detect state transitions.
User approves/denies via Virtual DJ in the browser.

Usage:
    python test/live/run.py              # all tests
    python test/live/run.py --case 1     # specific case
    python test/live/run.py --list       # list cases
"""

import subprocess
import sys
import time
import json
import argparse
import urllib.request
from pathlib import Path

# Force UTF-8 output on Windows
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent.parent
BRIDGE_SCRIPT = ROOT / "bridge" / "server.js"
SETUP_SCRIPT = ROOT / "cli" / "index.js"
BRIDGE_URL = "http://127.0.0.1:39200"

POLL_INTERVAL = 0.5  # seconds
MAX_WAIT = 120  # seconds per case

# ── Test Cases ──────────────────────────────────────────────────

# ── Prompt Candidates per Case ──────────────────────────────
# Each case offers multiple prompts. User picks one interactively.

PROMPT_CANDIDATES = {
    "bash_approve": [
        'Run: echo "claude-dj live test OK"',
        'Run: node -e "console.log(process.version)"',
        'Run: date',
        'Run: ls -la package.json',
    ],
    "read": [
        "Read package.json and tell me the version.",
        "Read bridge/config.js and list all config keys.",
        "Read hooks/permission.js and count the lines.",
    ],
    "write": [
        'Create test/live/scratch.txt with "hello from claude-dj".',
        'Create test/live/scratch.txt with today\'s date.',
        'Create test/live/scratch.txt containing "DJ test passed".',
    ],
    "edit": [
        'Edit test/live/scratch.txt — change content to "v2 updated".',
        'Edit test/live/scratch.txt — append " — verified" to the end.',
    ],
    "bash_deny": [
        'Run: rm -rf /tmp/fake-dir-12345',
        'Run: echo "this should be denied"',
        'Run: curl https://example.com',
    ],
    "multi_tool": [
        "Read package.json, then run: node -e \"console.log('name:', require('./package.json').name)\"",
        "Check git status, then read README.md and summarize it.",
        'Run "node --version" and "npm --version", report both.',
    ],
}


def pick_prompt(category, case_name):
    """Let user pick a prompt from candidates."""
    candidates = PROMPT_CANDIDATES.get(category, [])
    if not candidates:
        return None

    # Show 2-4 options
    shown = candidates[:4]
    print(f"    Pick a prompt for {cyan(case_name)}:")
    for i, p in enumerate(shown, 1):
        print(f"      {bold(str(i))}. {p}")
    print(f"      {dim('Enter')} = use #1")

    choice = input(f"    > ").strip()
    idx = int(choice) - 1 if choice.isdigit() and 1 <= int(choice) <= len(shown) else 0
    selected = shown[idx]
    print(f"    Selected: {green(selected)}")
    return selected


TEST_CASES = [
    {
        "id": 1,
        "name": "Bash: approve",
        "desc": "Bash tool -> PermissionRequest -> APPROVE on DJ",
        "category": "bash_approve",
        "expect_states": ["PROCESSING", "WAITING_BINARY"],
        "action": "Press APPROVE on Virtual DJ",
    },
    {
        "id": 2,
        "name": "Read file",
        "desc": "Read tool -> PreToolUse(notify) -> auto-allowed -> PROCESSING",
        "category": "read",
        "expect_states": ["PROCESSING", "IDLE"],
        "action": "No action needed (Read is auto-approved)",
    },
    {
        "id": 3,
        "name": "Write file",
        "desc": "Write tool -> PermissionRequest -> APPROVE on DJ -> file created",
        "category": "write",
        "expect_states": ["PROCESSING", "WAITING_BINARY"],
        "action": "Press APPROVE on Virtual DJ",
    },
    {
        "id": 4,
        "name": "Edit file",
        "desc": "Edit tool -> PermissionRequest -> APPROVE on DJ -> file updated",
        "category": "edit",
        "expect_states": ["PROCESSING", "WAITING_BINARY"],
        "action": "Press APPROVE on Virtual DJ",
        "depends_on": 3,
    },
    {
        "id": 5,
        "name": "Bash: deny",
        "desc": "Bash tool -> PermissionRequest -> DENY on DJ -> Claude sees denial",
        "category": "bash_deny",
        "expect_states": ["PROCESSING", "WAITING_BINARY"],
        "action": "Press DENY on Virtual DJ",
    },
    {
        "id": 6,
        "name": "Multi-tool",
        "desc": "Read + Bash -> multiple hooks -> APPROVE each on DJ",
        "category": "multi_tool",
        "expect_states": ["PROCESSING", "WAITING_BINARY"],
        "action": "Press APPROVE on Virtual DJ for each permission request",
    },
]


def color(text, code):
    if sys.stdout.isatty():
        return f"\033[{code}m{text}\033[0m"
    return text


def green(t): return color(t, 32)
def yellow(t): return color(t, 33)
def cyan(t): return color(t, 36)
def red(t): return color(t, 31)
def bold(t): return color(t, 1)
def dim(t): return color(t, 90)


def check_bridge_health():
    try:
        req = urllib.request.Request(f"{BRIDGE_URL}/api/health")
        with urllib.request.urlopen(req, timeout=2) as resp:
            data = json.loads(resp.read())
            return data.get("status") == "ok"
    except Exception:
        return False


def get_bridge_status():
    try:
        req = urllib.request.Request(f"{BRIDGE_URL}/api/status")
        with urllib.request.urlopen(req, timeout=2) as resp:
            return json.loads(resp.read())
    except Exception:
        return None


def start_bridge():
    if check_bridge_health():
        print(f"  {green('OK')} Bridge already running at {BRIDGE_URL}")
        return None

    print(f"  Starting bridge server...")
    proc = subprocess.Popen(
        ["node", str(BRIDGE_SCRIPT)],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        cwd=str(ROOT),
    )
    for _ in range(20):
        time.sleep(0.5)
        if check_bridge_health():
            print(f"  {green('OK')} Bridge started at {BRIDGE_URL}")
            return proc

    print(f"  {red('FAIL')} Bridge failed to start")
    proc.kill()
    sys.exit(1)


def run_setup():
    print(f"  Registering hooks...")
    result = subprocess.run(
        ["node", str(SETUP_SCRIPT), "setup"],
        capture_output=True, text=True, cwd=str(ROOT),
    )
    if result.returncode == 0:
        print(f"  {green('OK')} Hooks registered")
    else:
        print(f"  {red('FAIL')} Setup failed: {result.stderr}")
        sys.exit(1)


def launch_claude_interactive(prompt):
    """Launch Claude CLI in a new console window (interactive mode).
    Returns the subprocess.Popen handle."""
    if sys.platform == "win32":
        import ctypes
        CREATE_NEW_CONSOLE = 0x00000010
        proc = subprocess.Popen(
            ["claude", prompt],
            cwd=str(ROOT),
            creationflags=CREATE_NEW_CONSOLE,
        )
    else:
        proc = subprocess.Popen(
            ["claude", prompt],
            cwd=str(ROOT),
            start_new_session=True,
        )
    return proc


def get_session_ids():
    """Return set of known session IDs from bridge."""
    status = get_bridge_status()
    if not status:
        return set()
    return {s["id"] for s in status.get("sessions", [])}


def find_new_session(pre_ids, timeout_sec=30):
    """Wait for a new session to appear that wasn't in pre_ids."""
    start = time.time()
    while time.time() - start < timeout_sec:
        status = get_bridge_status()
        if status:
            for s in status.get("sessions", []):
                if s["id"] not in pre_ids:
                    return s["id"]
        time.sleep(POLL_INTERVAL)
    return None


def poll_bridge_states(target_sid, expect_states, timeout_sec=MAX_WAIT):
    """Poll bridge API tracking a specific session by ID.
    Returns (observed_states, timed_out)."""
    observed = []
    last_state = None
    start = time.time()

    while time.time() - start < timeout_sec:
        status = get_bridge_status()
        if status and status.get("sessions"):
            sessions = status["sessions"]
            total = len(sessions)

            # Find target session
            target = None
            for s in sessions:
                if s["id"] == target_sid:
                    target = s
                    break

            if not target:
                time.sleep(POLL_INTERVAL)
                continue

            state = target.get("state", "UNKNOWN")
            name = target.get("name", "?")

            if state != last_state:
                elapsed = time.time() - start
                observed.append(state)
                if state == "WAITING_BINARY":
                    sd = f"{yellow('WAITING_BINARY')} << action needed"
                elif state == "WAITING_CHOICE":
                    sd = f"{yellow('WAITING_CHOICE')} << action needed"
                elif state == "PROCESSING":
                    sd = f"{cyan('PROCESSING')}"
                elif state == "IDLE":
                    sd = f"{dim('IDLE')}"
                else:
                    sd = state
                print(f"    [{elapsed:5.1f}s] {name}:{target_sid[:8]} ({total} sessions) -> {sd}")
                last_state = state

            # Completion: IDLE after seeing activity
            if state == "IDLE" and len(observed) >= 2:
                return observed, False

            # For permission tests: IDLE after WAITING
            if state == "IDLE" and any(s.startswith("WAITING") for s in observed):
                return observed, False

            # For simple tests: IDLE after any state
            if state == "IDLE" and observed:
                # Give a bit more time in case more states come
                time.sleep(1)
                return observed, False

        time.sleep(POLL_INTERVAL)

    return observed, True


def run_test_case(case):
    cid = case["id"]
    cname = case["name"]
    print()
    print(f"  {bold(f'[Case {cid}]')} {cyan(cname)}")
    print(f"    {case['desc']}")
    print(f"    {yellow('ACTION:')} {case['action']}")
    print()

    # Let user pick a prompt
    prompt = pick_prompt(case["category"], cname)
    if not prompt:
        print(f"    {red('FAIL')} No prompts available for category: {case['category']}")
        return "fail"

    print()

    # Snapshot existing session IDs
    pre_ids = get_session_ids()

    # Launch Claude in a new terminal
    print(f"    Launching: claude \"{prompt[:55]}{'...' if len(prompt) > 55 else ''}\"")
    proc = launch_claude_interactive(prompt)

    # Wait for new session to appear
    print(f"    Waiting for new session...")
    target_sid = find_new_session(pre_ids, timeout_sec=30)

    if not target_sid:
        print(f"    {yellow('TIMEOUT')} No new session detected in bridge")
        return "timeout"

    print(f"    {green('OK')} New session: {target_sid[:8]}...")
    print(f"    Monitoring bridge states...")

    # Poll bridge for state transitions on this specific session
    observed, timed_out = poll_bridge_states(target_sid, case["expect_states"])

    print()
    if timed_out:
        print(f"    {yellow('TIMEOUT')} States observed: {' -> '.join(observed)}")
        print(f"    Expected: {' -> '.join(case['expect_states'])}")
        return "timeout"
    else:
        expect_key = set(case["expect_states"])
        observed_key = set(observed)
        matched = expect_key.issubset(observed_key)

        if matched:
            print(f"    {green('PASS')} States: {' -> '.join(observed)}")
        else:
            missing = expect_key - observed_key
            print(f"    {yellow('PARTIAL')} States: {' -> '.join(observed)}")
            print(f"    Missing: {missing}")
        return "pass" if matched else "partial"


def cleanup(bridge_proc):
    scratch = ROOT / "test" / "live" / "scratch.txt"
    if scratch.exists():
        scratch.unlink()
        print(f"  {green('OK')} Cleaned up scratch.txt")

    if bridge_proc:
        bridge_proc.terminate()
        bridge_proc.wait(timeout=5)
        print(f"  {green('OK')} Bridge stopped")


def main():
    parser = argparse.ArgumentParser(description="claude-dj Live Integration Test (Interactive)")
    parser.add_argument("--case", type=int, help="Run specific test case by ID")
    parser.add_argument("--list", action="store_true", help="List all test cases")
    parser.add_argument("--skip-setup", action="store_true", help="Skip hook registration")
    parser.add_argument("--no-bridge", action="store_true", help="Don't start bridge (assume running)")
    args = parser.parse_args()

    if args.list:
        print(f"\n{bold('claude-dj Live Test Cases (Interactive Mode):')}\n")
        for c in TEST_CASES:
            dep = f" (depends on #{c['depends_on']})" if c.get("depends_on") else ""
            cat = c["category"]
            n_prompts = len(PROMPT_CANDIDATES.get(cat, []))
            print(f"  [{c['id']}] {c['name']}{dep}")
            print(f"      {c['desc']}")
            print(f"      Action: {c['action']}")
            print(f"      Prompts: {n_prompts} candidates")
        print()
        return

    cases = TEST_CASES
    if args.case:
        cases = [c for c in TEST_CASES if c["id"] == args.case]
        if not cases:
            print(f"  {red('FAIL')} Case {args.case} not found")
            return

        dep_id = cases[0].get("depends_on")
        if dep_id:
            dep_case = [c for c in TEST_CASES if c["id"] == dep_id]
            cases = dep_case + cases

    print()
    print(bold("=" * 60))
    print(bold("  claude-dj Live Integration Test (Interactive)"))
    print(bold("=" * 60))
    print()
    print(f"  Mode: {cyan('INTERACTIVE')} - Claude opens in new terminal windows")
    print(f"  DJ:   {cyan(BRIDGE_URL)} - approve/deny via browser")
    print()

    # Phase 1
    print(bold("Phase 1: Infrastructure"))
    bridge_proc = None
    if not args.no_bridge:
        bridge_proc = start_bridge()
    if not args.skip_setup:
        run_setup()
    if not check_bridge_health():
        print(f"  {red('FAIL')} Bridge not reachable at {BRIDGE_URL}")
        sys.exit(1)

    print()
    print(bold(f"Phase 2: Running {len(cases)} test case(s)"))
    print(f"  {yellow('!')} Keep Virtual DJ open at {BRIDGE_URL}")
    print(f"  {yellow('!')} Each case opens a new Claude terminal window")
    print(f"  {yellow('!')} Approve/deny on the DJ when the buttons light up")

    results = {"pass": 0, "partial": 0, "timeout": 0, "fail": 0}

    try:
        for case in cases:
            result = run_test_case(case)
            results[result] = results.get(result, 0) + 1

            # Wait for user to be ready for next case
            if case != cases[-1]:
                print()
                input(f"    {dim('Press Enter for next case...')}")
    except KeyboardInterrupt:
        print(f"\n  {yellow('!')} Interrupted by user")
    finally:
        print()
        print(bold("Phase 3: Cleanup"))
        cleanup(bridge_proc)

    print()
    print(bold("=" * 60))
    p = results["pass"]
    t = results["timeout"]
    pa = results["partial"]
    total = sum(results.values())
    print(f"  Results: {green(f'{p} pass')}, {yellow(f'{pa} partial')}, {yellow(f'{t} timeout')} / {total} total")
    print(bold("=" * 60))
    print()

    sys.exit(0 if results["pass"] == total else 1)


if __name__ == "__main__":
    main()
