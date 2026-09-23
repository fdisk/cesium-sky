#!/usr/bin/env python3
"""
Local test server for the cesium-wind front/ viewer.

Serves front/ as the web root (same as `python -m http.server`), but
additionally substitutes the {{ MAPBOX_TOKEN }} placeholder inside HTML
responses with the actual Mapbox token — reproducing the production
server-side template substitution WITHOUT modifying view.html.

Token source (first match wins):
  1. Environment variable MAPBOX_TOKEN
  2. front/.mapbox_token  (gitignored file, one line, whitespace stripped)

If no token is found, the placeholder is left as-is (identical behavior
to a plain `python -m http.server`).

Usage:
  python front/serve.py                 # http://127.0.0.1:8765/view.html
  python front/serve.py --port 9000     # custom port
  set MAPBOX_TOKEN=pk.xxx && python front/serve.py   # token via env var
"""

import argparse
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

# Windows 콘솔(cp949)에서 유니코드 출력 깨짐 방지
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

PLACEHOLDER = "{{ MAPBOX_TOKEN }}"
DEFAULT_PORT = 8765
DEFAULT_BIND = "127.0.0.1"
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
TOKEN_FILE = os.path.join(SCRIPT_DIR, ".mapbox_token")
WEB_ROOT = SCRIPT_DIR  # front/ — set explicitly so cwd doesn't matter


def load_token():
    """Return the Mapbox token from env var or .mapbox_token file ('' if none)."""
    token = os.environ.get("MAPBOX_TOKEN", "").strip()
    if token:
        return token
    try:
        with open(TOKEN_FILE, "r", encoding="utf-8") as f:
            token = f.read().strip()
    except OSError:
        pass
    return token


class SubstitutingHandler(SimpleHTTPRequestHandler):
    # Set by main() before the server starts.
    mapbox_token = ""      # token to substitute ('' = no substitution)

    def __init__(self, *args, **kwargs):
        # Explicitly pin the web root to front/ (Python 3.13's base class
        # would otherwise default to the process cwd).
        super().__init__(*args, directory=WEB_ROOT, **kwargs)

    def do_GET(self):
        path = self.path.split("?", 1)[0].split("#", 1)[0]

        # Only HTML responses get the token substituted; .js/.bin/.json
        # etc. are served untouched by the base handler.
        if path.endswith(".html") or path in ("/", ""):
            rel = path.lstrip("/") or "index.html"
            full = os.path.join(WEB_ROOT, rel)
            if os.path.isfile(full):
                try:
                    with open(full, "rb") as f:
                        content = f.read()
                except OSError:
                    self.send_error(404, "File not found")
                    return

                if self.mapbox_token:
                    content = content.replace(
                        PLACEHOLDER.encode("utf-8"),
                        self.mapbox_token.encode("utf-8"),
                    )

                self.send_response(200)
                self.send_header("Content-Type", self.guess_type(full))
                self.send_header("Content-Length", str(len(content)))
                self.end_headers()
                self.wfile.write(content)
                return

        # Non-HTML paths (and missing index.html) → standard behavior.
        super().do_GET()


def main():
    parser = argparse.ArgumentParser(
        description="Local test server for cesium-wind front/ (substitutes {{ MAPBOX_TOKEN }} in HTML)"
    )
    parser.add_argument("--port", type=int, default=DEFAULT_PORT,
                        help=f"port to listen on (default: {DEFAULT_PORT})")
    parser.add_argument("--bind", default=DEFAULT_BIND,
                        help=f"interface to bind (default: {DEFAULT_BIND})")
    args = parser.parse_args()

    token = load_token()

    SubstitutingHandler.mapbox_token = token

    if token:
        masked = token[:6] + "..." + token[-4:] if len(token) > 12 else "***"
        print(f"[serve] MAPBOX_TOKEN active ({masked}, {len(token)} chars) — HTML responses will be substituted")
    else:
        print(f"[serve] No MAPBOX_TOKEN found (env var or {TOKEN_FILE}) — placeholder left as-is")
    print(f"[serve] Web root: {WEB_ROOT}")
    print(f"[serve] Open:     http://{args.bind}:{args.port}/view.html")

    server = ThreadingHTTPServer((args.bind, args.port), SubstitutingHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
