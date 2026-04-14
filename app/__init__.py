"""Application factory for the LIVE! M365 dashboard."""

import logging
import os

from flask import Flask, request

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(message)s")


def create_app() -> Flask:
    from app import config as cfg

    app = Flask(__name__, static_folder=cfg.BASE_DIR, template_folder=os.path.join(cfg.BASE_DIR, "templates"))

    if cfg._HAS_COMPRESS:
        from flask_compress import Compress
        Compress(app)

    # ── Register blueprints ────────────────────────────────────────────────────
    from app.blueprints import (
        auth, core, annotations, overrides, hierarchy, changelog,
        graph, reports, security, support, ai, admin, static_files,
    )

    for bp in [
        auth.bp, core.bp, annotations.bp, overrides.bp, hierarchy.bp,
        changelog.bp, graph.bp, reports.bp, security.bp, support.bp,
        ai.bp, admin.bp, static_files.bp,
    ]:
        app.register_blueprint(bp)

    # ── Auth middleware ────────────────────────────────────────────────────────
    @app.before_request
    def _auth_middleware():
        from app.auth_service import (
            get_auth_token, _validate_token as validate_token, resolve_tenant_id, get_user_role,
        )
        from app.config import PUBLIC_EXACT, PUBLIC_PREFIXES, DEFAULT_ROLE
        from flask import jsonify

        path = request.path

        if path in PUBLIC_EXACT:
            return None
        for prefix in PUBLIC_PREFIXES:
            if path.startswith(prefix):
                return None

        if path.startswith("/api/"):
            token = get_auth_token()
            if not token:
                return jsonify({"error": "Token de autenticação não fornecido"}), 401
            user = validate_token(token)
            if not user:
                return jsonify({"error": "Token inválido ou sem permissão"}), 403
            request.auth_user = user
            request.tenant_id = resolve_tenant_id()
            uname = user.get("username") or user.get("email") or user.get("name", "")
            request.auth_role = get_user_role(uname, request.tenant_id)
            return None

        return None

    # ── Security + cache headers ───────────────────────────────────────────────
    @app.after_request
    def _security_headers(response):
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
            "style-src 'self' 'unsafe-inline' fonts.googleapis.com; "
            "font-src 'self' fonts.gstatic.com; "
            "connect-src 'self' https://sso.liveoficial.ind.br https://cdn.jsdelivr.net; "
            "img-src 'self' data:; "
            "frame-ancestors 'none'"
        )
        if request.path.startswith("/api/") or request.path.endswith(".html"):
            response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"
        elif request.path.endswith((".js", ".css")):
            if request.args.get("v"):
                # Asset versionado — cache imutável de longa duração
                response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
            else:
                response.headers["Cache-Control"] = "no-cache"
            response.headers.pop("Pragma", None)
            response.headers.pop("Expires", None)
        return response

    return app
