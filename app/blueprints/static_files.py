"""Blueprint: /, /<page>, /<path:path> — serve HTML pages and static assets."""

import hashlib
import os
import time as _time

from flask import Blueprint, render_template, abort, send_from_directory

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
