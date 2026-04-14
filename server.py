#!/usr/bin/env python3
"""LIVE! M365 — entry point."""

from dotenv import load_dotenv
load_dotenv()

from app import create_app
from app.config import PORT

app = create_app()

if __name__ == "__main__":
    from app.auth_service import load_tenants_config
    from app.graph_service import ensure_sync_thread

    tenants_cfg = load_tenants_config()
    for tid, t in tenants_cfg.get("tenants", {}).items():
        if t.get("active"):
            ensure_sync_thread(tid)

    print(f"LIVE! M365 rodando em http://0.0.0.0:{PORT}")
    app.run(host="0.0.0.0", port=PORT, debug=False, threaded=True)
