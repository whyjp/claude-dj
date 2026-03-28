"""
claude-dj Live Integration Test
================================
Bridge start -> Hook registration -> Claude CLI test prompts.
Observe Virtual DJ (browser) for real-time button reactions.

Usage:
    python test/live/run.py              # all tests
    python test/live/run.py --case 1     # specific case
    python test/live/run.py --list       # list cases
"""

import subprocess
import sys
import time
import signal
import json
import os
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

# ── Test Cases ──────────────────────────────────────────────────
# 각 케이스는 Claude CLI 가 특정 tool 을 사용하도록 유도하는 프롬프트.
# Virtual DJ 에서 해당 hook 이벤트를 관찰 → 수동 approve/deny.

TEST_CASES = [
    {
        "id": 1,
        "name": "Bash: echo",
        "desc": "Bash tool -> PermissionRequest(binary) -> Approve on Virtual DJ",
        "prompt": 'Run this exact bash command: echo "claude-dj live test OK"',
        "expect_hook": "PermissionRequest",
        "expect_tool": "Bash",
        "expect_preset": "binary",
    },
    {
        "id": 2,
        "name": "Read file",
        "desc": "Read tool -> PreToolUse(notify) -> Virtual DJ shows PROCESSING",
        "prompt": "Read the file package.json and tell me the version field only.",
        "expect_hook": "PreToolUse",
        "expect_tool": "Read",
        "expect_preset": "processing",
    },
    {
        "id": 3,
        "name": "Write file",
        "desc": "Write tool -> PermissionRequest(binary) -> Approve/Deny on Virtual DJ",
        "prompt": 'Create a file called test/live/scratch.txt with the content "hello from claude-dj".',
        "expect_hook": "PermissionRequest",
        "expect_tool": "Write",
        "expect_preset": "binary",
    },
    {
        "id": 4,
        "name": "Edit file",
        "desc": "Edit tool -> PermissionRequest(binary) -> Approve on Virtual DJ",
        "prompt": 'Read test/live/scratch.txt then edit it to say "hello from claude-dj v2" instead.',
        "expect_hook": "PermissionRequest",
        "expect_tool": "Edit",
        "expect_preset": "binary",
        "depends_on": 3,
    },
    {
        "id": 5,
        "name": "Bash: multi-step",
        "desc": "Multiple Bash calls -> sequential PermissionRequests -> Approve each on DJ",
        "prompt": 'Run "node --version" and then "npm --version". Report both versions.',
        "expect_hook": "PermissionRequest",
        "expect_tool": "Bash",
        "expect_preset": "binary",
    },
    {
        "id": 6,
        "name": "Stop -> Idle",
        "desc": "Response complete -> Stop hook -> Virtual DJ ALL_DIM (idle)",
        "prompt": "What is 2 + 2? Answer with just the number.",
        "expect_hook": "Stop",
        "expect_tool": None,
        "expect_preset": "idle",
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


def check_bridge_health():
    """Bridge 서버 health check."""
    try:
        req = urllib.request.Request(f"{BRIDGE_URL}/api/health")
        with urllib.request.urlopen(req, timeout=2) as resp:
            data = json.loads(resp.read())
            return data.get("status") == "ok"
    except Exception:
        return False


def start_bridge():
    """Bridge 서버를 subprocess 로 시작."""
    if check_bridge_health():
        print(f"  {green('✓')} Bridge already running at {BRIDGE_URL}")
        return None

    print(f"  Starting bridge server...")
    proc = subprocess.Popen(
        ["node", str(BRIDGE_SCRIPT)],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        cwd=str(ROOT),
    )

    # Wait for server to be ready
    for _ in range(20):
        time.sleep(0.5)
        if check_bridge_health():
            print(f"  {green('✓')} Bridge started at {BRIDGE_URL}")
            return proc

    print(f"  {red('✗')} Bridge failed to start")
    proc.kill()
    sys.exit(1)


def run_setup():
    """Hook 등록 (claude-dj setup)."""
    print(f"  Registering hooks...")
    result = subprocess.run(
        ["node", str(SETUP_SCRIPT), "setup"],
        capture_output=True,
        text=True,
        cwd=str(ROOT),
    )
    if result.returncode == 0:
        print(f"  {green('✓')} Hooks registered")
        for line in result.stdout.strip().splitlines():
            print(f"    {line}")
    else:
        print(f"  {red('✗')} Setup failed: {result.stderr}")
        sys.exit(1)


def run_claude(prompt, timeout_sec=120):
    """Claude CLI 를 -p 모드로 실행. hook 이 Bridge 로 이벤트 전달."""
    cmd = [
        "claude",
        "-p",
        "--output-format", "json",
        "--no-session-persistence",
        "--max-budget-usd", "0.50",
        prompt,
    ]

    print(f"    $ claude -p \"{prompt[:60]}{'...' if len(prompt) > 60 else ''}\"")

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            cwd=str(ROOT),
            timeout=timeout_sec,
        )
        return {
            "exit_code": result.returncode,
            "stdout": result.stdout or "",
            "stderr": result.stderr or "",
        }
    except subprocess.TimeoutExpired:
        return {"exit_code": -1, "stdout": "", "stderr": "timeout"}


def get_bridge_status():
    """Bridge 의 현재 세션 상태 조회."""
    try:
        req = urllib.request.Request(f"{BRIDGE_URL}/api/status")
        with urllib.request.urlopen(req, timeout=2) as resp:
            return json.loads(resp.read())
    except Exception:
        return None


def run_test_case(case):
    """단일 테스트 케이스 실행."""
    print()
    cid = case["id"]
    cname = case["name"]
    print(f"  {bold(f'[Case {cid}]')} {cyan(cname)}")
    print(f"    {case['desc']}")
    ehook = case["expect_hook"]
    etool = case["expect_tool"]
    epreset = case["expect_preset"]
    print(f"    expect: hook={ehook} tool={etool} preset={epreset}")
    print()

    result = run_claude(case["prompt"])

    print()
    if result["exit_code"] == 0:
        # Try to parse JSON output
        stdout = result.get("stdout") or ""
        try:
            output = json.loads(stdout)
            text = output.get("result", stdout[:200])
        except (json.JSONDecodeError, TypeError):
            text = stdout[:200]
        print(f"    {green('✓')} Claude responded (exit 0)")
        print(f"    Response: {text[:120]}")
    elif result["exit_code"] == -1:
        print(f"    {yellow('⏱')} Timeout — check if Virtual DJ needs button press")
    else:
        print(f"    {red('✗')} Exit code {result['exit_code']}")
        if result["stderr"]:
            print(f"    stderr: {result['stderr'][:200]}")

    # Check bridge state after
    status = get_bridge_status()
    if status and status.get("sessions"):
        for s in status["sessions"]:
            print(f"    Bridge session: {s.get('name', '?')} → {s.get('state', '?')}")

    return result["exit_code"] == 0


def cleanup(bridge_proc):
    """정리."""
    # Remove scratch file if created
    scratch = ROOT / "test" / "live" / "scratch.txt"
    if scratch.exists():
        scratch.unlink()
        print(f"  {green('✓')} Cleaned up scratch.txt")

    if bridge_proc:
        bridge_proc.terminate()
        bridge_proc.wait(timeout=5)
        print(f"  {green('✓')} Bridge stopped")


def main():
    parser = argparse.ArgumentParser(description="claude-dj Live Integration Test")
    parser.add_argument("--case", type=int, help="Run specific test case by ID")
    parser.add_argument("--list", action="store_true", help="List all test cases")
    parser.add_argument("--skip-setup", action="store_true", help="Skip hook registration")
    parser.add_argument("--no-bridge", action="store_true", help="Don't start bridge (assume running)")
    args = parser.parse_args()

    if args.list:
        print(f"\n{bold('claude-dj Live Test Cases:')}\n")
        for c in TEST_CASES:
            dep = f" (depends on #{c['depends_on']})" if c.get("depends_on") else ""
            print(f"  [{c['id']}] {c['name']}{dep}")
            print(f"      {c['desc']}")
        print()
        return

    cases = TEST_CASES
    if args.case:
        cases = [c for c in TEST_CASES if c["id"] == args.case]
        if not cases:
            print(f"  {red('✗')} Case {args.case} not found")
            return

        # Include dependencies
        dep_id = cases[0].get("depends_on")
        if dep_id:
            dep_case = [c for c in TEST_CASES if c["id"] == dep_id]
            cases = dep_case + cases

    print()
    print(bold("=" * 60))
    print(bold("  claude-dj Live Integration Test"))
    print(bold("=" * 60))
    print()

    # ── Phase 1: Infrastructure ──
    print(bold("Phase 1: Infrastructure"))

    bridge_proc = None
    if not args.no_bridge:
        bridge_proc = start_bridge()

    if not args.skip_setup:
        run_setup()

    # Verify bridge
    if not check_bridge_health():
        print(f"  {red('✗')} Bridge not reachable at {BRIDGE_URL}")
        sys.exit(1)

    print()
    print(bold(f"Phase 2: Running {len(cases)} test case(s)"))
    print(f"  {yellow('!')} Open Virtual DJ in browser: {BRIDGE_URL}")
    print(f"  {yellow('!')} Press approve/deny buttons on Virtual DJ for PermissionRequest")

    passed = 0
    failed = 0

    try:
        for case in cases:
            ok = run_test_case(case)
            if ok:
                passed += 1
            else:
                failed += 1
    except KeyboardInterrupt:
        print(f"\n  {yellow('!')} Interrupted by user")
    finally:
        print()
        print(bold("Phase 3: Cleanup"))
        cleanup(bridge_proc)

    print()
    print(bold("=" * 60))
    print(f"  Results: {green(f'{passed} passed')}, {red(f'{failed} failed') if failed else '0 failed'}")
    print(bold("=" * 60))
    print()

    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
