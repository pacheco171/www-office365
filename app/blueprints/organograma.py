"""Blueprint: /api/organograma — hierarquia de responsáveis por setor."""

import unicodedata

from flask import Blueprint, request, jsonify

from app.auth_service import require_role
from app.config import DEFAULT_ROLE
from app.utils import (
    get_tenant_lock, load_json_safe, save_json_atomic, tenant_path,
    _invalidate_data_cache,
)
from app.blueprints.core import _get_processed_rows

bp = Blueprint("organograma", __name__)

# ── Ranking de cargos ─────────────────────────────────────────────────────────
# Menor número = mais alto na hierarquia

_CARGO_RANK = [
    (1, ["diretor", "diretora", "director"]),
    (2, ["gerente", "manager"]),
    (3, ["coordenador", "coordenadora", "coordinator"]),
    (4, ["supervisor", "supervisora"]),
    (5, ["líder", "lider", "lider de", "encarregado", "encarregada", "chefe"]),
    (6, ["sênior", "senior", " sr ", " sr.", "sr."]),
    (7, ["analista", "specialist", "especialista"]),
    (8, ["assistente", "assistant", "auxiliar", "assistência"]),
    (9, ["operador", "operadora", "técnico", "tecnico", "estampador"]),
]


def _norm(s: str) -> str:
    """Remove acentos e normaliza para lowercase."""
    return unicodedata.normalize("NFD", s or "").encode("ascii", "ignore").decode().lower()


def _cargo_level(cargo: str) -> int:
    """Retorna o nível hierárquico de um cargo. Menor = mais alto."""
    c = _norm(cargo)
    for level, keywords in _CARGO_RANK:
        if any(kw in c for kw in keywords):
            return level
    return 99


# ── Construção da árvore ──────────────────────────────────────────────────────

def _build_tree(members: list, tree_overrides: dict) -> list:
    """
    Constrói árvore hierárquica recursiva.

    members: lista de dicts com { email, nome, cargo, nivel, ... }
    tree_overrides: { email: parent_email | None }  — parent_email vazio = raiz

    Retorna lista de nós raiz, cada um com campo 'children'.
    """
    if not members:
        return []

    # Ordena por nível depois nome
    sorted_members = sorted(members, key=lambda m: (m["nivel"], _norm(m.get("nome") or "")))

    # Cria nós limpos com children
    nodes = {}
    for m in sorted_members:
        nodes[m["email"]] = {
            "nome":   m.get("nome") or "",
            "email":  m.get("email") or "",
            "cargo":  m.get("cargo") or "",
            "nivel":  m.get("nivel", 99),
            "children": [],
        }

    # Monta mapa de pai: email → parent_email (ou None = raiz)
    parent_map = {}

    # Primeiro aplica overrides manuais
    for email, parent_email in tree_overrides.items():
        if email in nodes:
            parent_map[email] = parent_email if parent_email else None

    # Preenche automaticamente quem não tem override
    # Mantém trilha do último nó adicionado por nível
    last_at_level: dict[int, str] = {}  # nivel → email

    for m in sorted_members:
        email = m["email"]
        nivel = m["nivel"]

        if email not in parent_map:
            # Encontra o pai: pessoa com nivel mais próximo e estritamente menor
            parent_email = None
            best_level = -1
            for lvl, em in last_at_level.items():
                if lvl < nivel and lvl > best_level:
                    best_level = lvl
                    parent_email = em
            parent_map[email] = parent_email

        last_at_level[nivel] = email

    # Monta a árvore
    roots = []
    for email, node in nodes.items():
        parent_email = parent_map.get(email)
        if parent_email and parent_email in nodes:
            nodes[parent_email]["children"].append(node)
        else:
            roots.append(node)

    return roots


# ── Endpoint GET /api/organograma ─────────────────────────────────────────────

@bp.route("/api/organograma", methods=["GET"])
def get_organograma():
    tid = getattr(request, "tenant_id", "live")
    rows = _get_processed_rows(tid)

    hier_data = load_json_safe(tenant_path(tid, "hierarchy.json"), {"hierarchy": {}})
    hier = hier_data.get("hierarchy", {})

    # Agrupa colaboradores ativos por macro
    by_macro: dict[str, list] = {}
    for r in rows:
        if r.get("status") == "Inativo":
            continue
        if r.get("tipo") not in (None, "", "Pessoa"):
            continue
        macro = r.get("macro") or r.get("setor") or "Sem setor"
        by_macro.setdefault(macro, []).append(r)

    result = []
    for macro, members in sorted(by_macro.items()):
        macro_cfg = hier.get(macro, {})
        manual_email = macro_cfg.get("responsavel_email")
        tree_overrides = macro_cfg.get("tree_overrides", {})
        gerente_email = (macro_cfg.get("gerente_email") or "").strip()
        coordenadores_emails = {
            e for e in (macro_cfg.get("coordenadores_emails") or [])
            if isinstance(e, str) and e and e != gerente_email
        }

        for m in members:
            email = m.get("email") or ""
            level = _cargo_level(m.get("cargo") or "")
            if email and email == gerente_email:
                level = 2
            elif email and email in coordenadores_emails:
                level = 3
            m["_nivel"] = level

        members_sorted = sorted(members, key=lambda m: (m["_nivel"], _norm(m.get("nome") or "")))

        leaders = [m for m in members_sorted if m["_nivel"] in (2, 3)]

        responsavel = None
        if gerente_email:
            gerente_member = next((m for m in members_sorted if m.get("email") == gerente_email), None)
            if gerente_member:
                responsavel = _build_resp(gerente_member, "manual")

        if not responsavel and manual_email:
            manual_member = next((m for m in members_sorted if m.get("email") == manual_email), None)
            if manual_member:
                responsavel = _build_resp(manual_member, "manual")

        if not responsavel and leaders:
            responsavel = _build_resp(leaders[0], "auto")

        resp_email = responsavel["email"] if responsavel else None
        equipe = [_build_member(m) for m in leaders if m.get("email") != resp_email]

        flat_for_tree = [
            {"email": m.get("email") or "", "nome": m.get("nome") or "",
             "cargo": m.get("cargo") or "", "nivel": m["_nivel"]}
            for m in leaders
        ]
        tree = _build_tree(flat_for_tree, tree_overrides)

        todos_membros = [
            {"email": m.get("email") or "", "nome": m.get("nome") or "", "cargo": m.get("cargo") or ""}
            for m in members_sorted if m.get("email")
        ]

        result.append({
            "macro": macro,
            "responsavel": responsavel,
            "equipe": equipe,
            "tree": tree,
            "total": len(members),
            "gerente_email": gerente_email,
            "coordenadores_emails": sorted(coordenadores_emails),
            "todos_membros": todos_membros,
        })

    role = getattr(request, "auth_role", DEFAULT_ROLE)
    if role == "gestor":
        setor = getattr(request, "auth_setor", None) or ""
        result = [s for s in result if s["macro"] == setor] if setor else []

    return jsonify(result)


def _build_resp(m: dict, origem: str) -> dict:
    return {
        "nome":   m.get("nome") or "",
        "email":  m.get("email") or "",
        "cargo":  m.get("cargo") or "",
        "nivel":  m.get("_nivel", 99),
        "origem": origem,
    }


def _build_member(m: dict) -> dict:
    return {
        "nome":  m.get("nome") or "",
        "email": m.get("email") or "",
        "cargo": m.get("cargo") or "",
        "nivel": m.get("_nivel", 99),
        "area":  m.get("hierArea") or m.get("area") or "",
    }


# ── Endpoint POST /api/organograma/responsavel ────────────────────────────────

@bp.route("/api/organograma/responsavel", methods=["POST"])
def set_responsavel():
    check = require_role("superadmin")
    if check:
        return check

    payload = request.get_json(force=True, silent=True)
    if not isinstance(payload, dict):
        return jsonify({"error": "payload inválido"}), 400

    macro = payload.get("macro", "").strip()
    email = payload.get("email", "").strip()

    if not macro:
        return jsonify({"error": "macro obrigatório"}), 400

    tid = getattr(request, "tenant_id", "live")
    with get_tenant_lock(tid, "hierarchy"):
        hier_data = load_json_safe(tenant_path(tid, "hierarchy.json"), {"hierarchy": {}})
        hier = hier_data.setdefault("hierarchy", {})
        macro_cfg = hier.setdefault(macro, {})
        if email:
            macro_cfg["responsavel_email"] = email
        else:
            macro_cfg.pop("responsavel_email", None)
        save_json_atomic(tenant_path(tid, "hierarchy.json"), hier_data)

    _invalidate_data_cache(tid)
    return jsonify({"ok": True})


# ── Endpoint POST /api/organograma/papeis ─────────────────────────────────────

@bp.route("/api/organograma/papeis", methods=["POST"])
def set_papeis():
    check = require_role("superadmin")
    if check:
        return check

    payload = request.get_json(force=True, silent=True)
    if not isinstance(payload, dict):
        return jsonify({"error": "payload inválido"}), 400

    macro = (payload.get("macro") or "").strip()
    gerente_email = (payload.get("gerente_email") or "").strip()
    coords_raw = payload.get("coordenadores_emails") or []

    if not macro:
        return jsonify({"error": "macro obrigatório"}), 400
    if not isinstance(coords_raw, list):
        return jsonify({"error": "coordenadores_emails deve ser lista"}), 400

    seen = set()
    coordenadores = []
    for e in coords_raw:
        if not isinstance(e, str):
            continue
        email = e.strip()
        if not email or email == gerente_email or email in seen:
            continue
        seen.add(email)
        coordenadores.append(email)

    tid = getattr(request, "tenant_id", "live")
    with get_tenant_lock(tid, "hierarchy"):
        hier_data = load_json_safe(tenant_path(tid, "hierarchy.json"), {"hierarchy": {}})
        hier = hier_data.setdefault("hierarchy", {})
        macro_cfg = hier.setdefault(macro, {})

        if gerente_email:
            macro_cfg["gerente_email"] = gerente_email
        else:
            macro_cfg.pop("gerente_email", None)

        if coordenadores:
            macro_cfg["coordenadores_emails"] = coordenadores
        else:
            macro_cfg.pop("coordenadores_emails", None)

        save_json_atomic(tenant_path(tid, "hierarchy.json"), hier_data)

    _invalidate_data_cache(tid)
    return jsonify({"ok": True})


# ── Endpoint POST /api/organograma/tree ───────────────────────────────────────

@bp.route("/api/organograma/tree", methods=["POST"])
def set_tree():
    check = require_role("superadmin")
    if check:
        return check

    payload = request.get_json(force=True, silent=True)
    if not isinstance(payload, dict):
        return jsonify({"error": "payload inválido"}), 400

    macro = payload.get("macro", "").strip()
    overrides = payload.get("overrides")  # { email: parent_email | "" }

    if not macro:
        return jsonify({"error": "macro obrigatório"}), 400

    tid = getattr(request, "tenant_id", "live")
    with get_tenant_lock(tid, "hierarchy"):
        hier_data = load_json_safe(tenant_path(tid, "hierarchy.json"), {"hierarchy": {}})
        hier = hier_data.setdefault("hierarchy", {})
        macro_cfg = hier.setdefault(macro, {})

        if overrides is None:
            # Reset: remove todos os overrides de árvore
            macro_cfg.pop("tree_overrides", None)
        elif isinstance(overrides, dict):
            macro_cfg["tree_overrides"] = overrides
        else:
            return jsonify({"error": "overrides deve ser objeto"}), 400

        save_json_atomic(tenant_path(tid, "hierarchy.json"), hier_data)

    _invalidate_data_cache(tid)
    return jsonify({"ok": True})
