#!/usr/bin/env python3
"""Start the Code Explainer API and UI: frees the listen port, then opens the browser."""

from __future__ import annotations

import os
import signal
import subprocess
import sys
import time
import webbrowser
from pathlib import Path

HOST = "127.0.0.1"
PORT = 8765

ROOT = Path(__file__).resolve().parent
APP_DIR = ROOT / "code_explainer"
URL = f"http://{HOST}:{PORT}/"


def kill_listeners_on_port_windows(port: int) -> None:
    try:
        completed = subprocess.run(
            f"netstat -ano | findstr :{port}",
            shell=True,
            capture_output=True,
            text=True,
        )
        text = (completed.stdout or "") + (completed.stderr or "")
    except OSError:
        return

    seen: set[str] = set()
    for line in text.splitlines():
        line_up = line.upper()
        if "LISTENING" not in line_up:
            continue
        parts = line.split()
        if len(parts) < 5:
            continue
        pid = parts[-1]
        if not pid.isdigit() or pid in seen:
            continue
        seen.add(pid)
        subprocess.run(
            ["taskkill", "/F", "/PID", pid],
            capture_output=True,
            stdin=subprocess.DEVNULL,
        )


def kill_listeners_on_port_posix(port: int) -> None:
    try:
        out = subprocess.check_output(
            ["sh", "-c", f"lsof -ti:{port} 2>/dev/null"],
            text=True,
        )
    except (subprocess.CalledProcessError, FileNotFoundError):
        return
    for pid in out.split():
        if pid.isdigit():
            try:
                os.kill(int(pid), signal.SIGKILL)
            except ProcessLookupError:
                pass


def free_port(port: int) -> None:
    if sys.platform == "win32":
        kill_listeners_on_port_windows(port)
    else:
        kill_listeners_on_port_posix(port)
    time.sleep(0.35)


def main() -> None:
    if not APP_DIR.is_dir():
        print(f"Expected app folder at {APP_DIR}", file=sys.stderr)
        sys.exit(1)

    free_port(PORT)

    cmd = [
        sys.executable,
        "-m",
        "uvicorn",
        "backend.app:app",
        "--host",
        HOST,
        "--port",
        str(PORT),
    ]

    env = os.environ.copy()
    proc = subprocess.Popen(
        cmd,
        cwd=str(APP_DIR),
        env=env,
        stdin=subprocess.DEVNULL,
    )

    deadline = time.time() + 30
    while time.time() < deadline:
        if proc.poll() is not None:
            print("Server exited early. Check your environment and dependencies.", file=sys.stderr)
            sys.exit(proc.returncode or 1)
        try:
            import urllib.error
            import urllib.request

            urllib.request.urlopen(URL, timeout=0.5).read(1)
            break
        except Exception:
            time.sleep(0.25)
    else:
        proc.terminate()
        print("Server did not become ready in time.", file=sys.stderr)
        sys.exit(1)

    webbrowser.open(URL)

    print(f"Server running at {URL}")
    print("Press Ctrl+C to stop.")

    try:
        proc.wait()
    except KeyboardInterrupt:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
        sys.exit(0)


if __name__ == "__main__":
    main()
