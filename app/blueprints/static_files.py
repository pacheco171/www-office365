"""Blueprint: /, /<page>, /<path:path> — serve HTML pages and static assets."""

import hashlib
import os
import time as _time

from flask import Blueprint, render_template, abort, send_from_directory, request

from app.config import BASE_DIR, STATIC_ALLOWED_EXT

bp = Blueprint("static_files", __name__)

# Hash de versão dos assets estáticos — muda a cada deploy/hora para invalidar cache
_SV = hashlib.md5(str(int(_time.time())).encode()).hexdigest()[:8]

_PAGES = {
    'dashboard': 'dashboard.html',
    'colaboradores': 'colaboradores.html',
    'licencas': 'licencas.html',
    'setores': 'setores.html',
    'historico': 'historico.html',
    'radar': 'radar.html',
    'contratos': 'contratos.html',
    'relatorio': 'relatorio.html',
    'auditoria': 'auditoria.html',
    'sugestoes': 'sugestoes.html',
    'config': 'config.html',
    'exchange': 'exchange.html',
    'onedrive': 'onedrive.html',
    'dominios': 'dominios.html',
    'grupos': 'grupos.html',
    'aplicativos': 'aplicativos.html',
    'privilegios': 'privilegios.html',
    'politicas': 'politicas.html',
    'alertas': 'alertas.html',
    'assessment': 'assessment.html',
    'suporte': 'suporte.html',
    'organograma': 'organograma.html',
}

_PAGE_ROLES = {
    "colaboradores": ("admin", "tecnico", "gestor", "superadmin"),
    "organograma":   ("admin", "tecnico", "superadmin"),
    "licencas":      ("admin", "tecnico", "superadmin"),
    "setores":       ("admin", "tecnico", "superadmin"),
    "historico":     ("admin", "tecnico", "superadmin"),
    "radar":         ("admin", "tecnico", "superadmin"),
    "contratos":     ("admin", "tecnico", "superadmin"),
    "relatorio":     ("admin", "tecnico", "superadmin"),
    "auditoria":     ("admin", "tecnico", "superadmin"),
    "sugestoes":     ("admin", "tecnico", "superadmin"),
    "config":        ("admin", "superadmin"),
    "exchange":      ("admin", "tecnico", "superadmin"),
    "onedrive":      ("admin", "tecnico", "superadmin"),
    "dominios":      ("admin", "tecnico", "superadmin"),
    "grupos":        ("admin", "tecnico", "superadmin"),
    "aplicativos":   ("admin", "tecnico", "superadmin"),
    "privilegios":   ("admin", "tecnico", "superadmin"),
    "politicas":     ("admin", "tecnico", "superadmin"),
    "alertas":       ("admin", "tecnico", "superadmin"),
    "assessment":    ("admin", "tecnico", "superadmin"),
    "suporte":       ("admin", "tecnico", "superadmin"),
}

_ROLE_LABELS = {
    "superadmin": "Super Admin",
    "admin": "Admin",
    "tecnico": "Técnico",
    "gestor": "Gestor",
}

_BLOCKED_FILES = {
    "data.json", "overrides.json", "graph_config.json", "changelog.json",
    "hierarchy.json", "suggestions.json", "annotations.json", "roles.json",
    ".env", "server.py",
}


@bp.route("/")
def root():
    return render_template('dashboard.html', active_page='dashboard', sv=_SV)


@bp.route("/<page>")
def page_view(page):
    if page in _PAGES:
        allowed = _PAGE_ROLES.get(page)
        if allowed:
            role = getattr(request, "auth_role", "tecnico")
            if role not in allowed:
                return render_template("403.html", sv=_SV, role=role, role_label=_ROLE_LABELS.get(role, role)), 403
        return render_template(_PAGES[page], active_page=page, sv=_SV)
    return _serve_static(page)


@bp.route("/<path:path>")
def static_files(path):
    return _serve_static(path)


def _serve_static(path: str):
    """Serve static files with path traversal and extension protection."""
    if ".." in path or path.startswith("/"):
        abort(404)
    full = os.path.realpath(os.path.join(BASE_DIR, path))
    if not full.startswith(os.path.realpath(BASE_DIR)):
        abort(404)
    if os.path.basename(path).lower() in _BLOCKED_FILES:
        abort(404)
    _, ext = os.path.splitext(path)
    if ext.lower() not in STATIC_ALLOWED_EXT:
        abort(404)
    return send_from_directory(BASE_DIR, path)
