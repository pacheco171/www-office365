"""Blueprint: /api/import/rh-csv — importação de CSV do RH para overrides de cargo/setor."""

import csv
import io
import unicodedata
from datetime import datetime, timezone

from flask import Blueprint, request, jsonify

from app.auth_service import require_role
from app.config import http_requests
from app.graph_service import schedule_async_sync
from app.utils import (
    get_tenant_lock, load_data, load_overrides, save_json_atomic,
    tenant_path, _invalidate_data_cache,
)

bp = Blueprint("import_rh", __name__)

# Colunas esperadas no CSV do RH
_COL_NOME = "nomFun"
_COL_CARGO = "desCar"
_COL_SETOR = "nomLoc"
_COL_EMAIL_PESSOAL = "emaPar"
_COL_STATUS = "sitAfa"


def _norm_name(name: str) -> str:
    """Normaliza nome para comparação: maiúsculas, sem acentos, espaços colapsados."""
    name = (name or "").strip().upper()
    nfkd = unicodedata.normalize("NFD", name)
    sem_acento = "".join(c for c in nfkd if unicodedata.category(c) != "Mn")
    return " ".join(sem_acento.split())


def _parse_csv(file_bytes: bytes) -> list[dict]:
    """Tenta decodificar o CSV em utf-8 ou latin-1 e retorna lista de dicts."""
    for encoding in ("latin-1", "cp1252", "utf-8-sig", "utf-8"):
        try:
            text = file_bytes.decode(encoding)
            reader = csv.DictReader(io.StringIO(text))
            rows = list(reader)
            if rows and _COL_NOME in rows[0]:
                return rows
        except Exception:
            continue
    return []


def _graph_patch_user(token: str, email: str, department: str, job_title: str) -> dict:
    """Tenta PATCH no AD via Graph API. Retorna dict com status."""
    if not http_requests or not token:
        return {"ok": False, "reason": "requests não disponível ou sem token"}
    url = f"https://graph.microsoft.com/v1.0/users/{email}"
    payload = {}
    if department:
        payload["department"] = department
    if job_title:
        payload["jobTitle"] = job_title
    if not payload:
        return {"ok": False, "reason": "sem dados para atualizar"}
    try:
        resp = http_requests.patch(
            url,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=10,
        )
        if resp.status_code == 204:
            return {"ok": True}
        return {"ok": False, "reason": f"HTTP {resp.status_code}", "detail": resp.text[:200]}
    except Exception as exc:
        return {"ok": False, "reason": str(exc)}


@bp.route("/api/ad-patch/<path:email>", methods=["POST"])
def ad_patch_user(email):
    """Atualiza cargo e/ou setor de um usuário diretamente no AD via Graph API."""
    check = require_role("superadmin")
    if check:
        return check

    payload = request.get_json(force=True, silent=True) or {}
    cargo = (payload.get("cargo") or "").strip()
    setor = (payload.get("setor") or "").strip()

    if not cargo and not setor:
        return jsonify({"error": "Informe cargo ou setor"}), 400

    tid = getattr(request, "tenant_id", "live")
    try:
        from app.graph_service import load_graph_config, graph_get_token
        cfg = load_graph_config(tid)
        token = graph_get_token(cfg)
    except Exception as exc:
        return jsonify({"ok": False, "reason": f"Erro ao obter token: {exc}"}), 500

    result = _graph_patch_user(token, email, setor, cargo)
    status = 200 if result.get("ok") else 502
    if result.get("ok"):
        schedule_async_sync(tid, delay_seconds=15, source="ad-patch")
    return jsonify(result), status


@bp.route("/api/import/rh-csv", methods=["POST"])
def import_rh_csv():
    """
    Importa CSV do RH e cria/atualiza overrides de cargo e setor.

    Corpo: multipart/form-data, campo 'file' com o CSV.
    Query: ?sync_ad=true para tentar atualizar o AD via Graph (requer User.ReadWrite.All).
    """
    check = require_role("superadmin")
    if check:
        return check

    uploaded = request.files.get("file")
    if not uploaded:
        return jsonify({"error": "Campo 'file' ausente"}), 400

    file_bytes = uploaded.read()
    rows = _parse_csv(file_bytes)
    if not rows:
        return jsonify({"error": "CSV não reconhecido ou colunas ausentes"}), 400

    tid = getattr(request, "tenant_id", "live")
    sync_ad = request.args.get("sync_ad", "").lower() == "true"

    # Carregar dados do sistema e construir mapa nome_normalizado → registro
    data = load_data(tid)
    db = data.get("db", [])
    name_map: dict[str, dict] = {}
    for rec in db:
        nome_norm = _norm_name(rec.get("nome", ""))
        if nome_norm:
            name_map[nome_norm] = rec

    # Obter token do Graph se necessário
    graph_token = None
    if sync_ad:
        try:
            from app.graph_service import load_graph_config, graph_get_token
            cfg = load_graph_config(tid)
            graph_token = graph_get_token(cfg)
        except Exception:
            graph_token = None

    # Carregar overrides existentes
    ov_data = load_overrides(tid)
    overrides = ov_data.setdefault("overrides", {})

    matched: list[dict] = []
    unmatched: list[dict] = []
    now_iso = datetime.now(timezone.utc).isoformat()

    for row in rows:
        nome_csv = (row.get(_COL_NOME) or "").strip()
        if not nome_csv:
            continue

        cargo_csv = (row.get(_COL_CARGO) or "").strip()
        setor_csv = (row.get(_COL_SETOR) or "").strip()
        email_pessoal = (row.get(_COL_EMAIL_PESSOAL) or "").strip().lower()

        if not setor_csv and not cargo_csv:
            # Linha sem dados úteis — ignorar
            unmatched.append({"nome_csv": nome_csv, "motivo": "sem cargo/setor no CSV"})
            continue

        nome_norm = _norm_name(nome_csv)
        rec = name_map.get(nome_norm)

        if rec is None:
            unmatched.append({
                "nome_csv": nome_csv,
                "cargo_csv": cargo_csv,
                "setor_csv": setor_csv,
                "motivo": "nome não encontrado no sistema",
            })
            continue

        email_corp = (rec.get("email") or "").strip().lower()
        if not email_corp:
            unmatched.append({
                "nome_csv": nome_csv,
                "motivo": "colaborador sem email corporativo no sistema",
            })
            continue

        # Montar override
        entry: dict = {
            "fixo": True,
            "fonte": "csv_rh",
            "updatedAt": now_iso,
        }
        if setor_csv:
            entry["setor"] = setor_csv
        if cargo_csv:
            entry["cargo"] = cargo_csv

        # Preservar campos que já existiam e não estão no CSV
        existing = overrides.get(email_corp, {})
        for field in ("tipo", "area", "subarea"):
            if field in existing and field not in entry:
                entry[field] = existing[field]

        # Se não houver setor no CSV mas já houver no override, manter
        if "setor" not in entry and "setor" in existing:
            entry["setor"] = existing["setor"]

        # Setor é obrigatório no override — usar fallback do sistema se necessário
        if "setor" not in entry:
            entry["setor"] = rec.get("setor", "Sem Setor")

        overrides[email_corp] = entry

        result_entry = {
            "nome": rec.get("nome"),
            "email": email_corp,
            "cargo": cargo_csv,
            "setor": setor_csv,
        }

        # Sync AD opcional
        if sync_ad:
            ad_result = _graph_patch_user(graph_token, email_corp, setor_csv, cargo_csv)
            result_entry["ad"] = ad_result

        matched.append(result_entry)

    # Salvar overrides atomicamente
    with get_tenant_lock(tid, "overrides"):
        save_json_atomic(tenant_path(tid, "overrides.json"), ov_data)
    _invalidate_data_cache(tid)
    schedule_async_sync(tid, delay_seconds=15 if sync_ad else 5, source="import.rh-csv")

    return jsonify({
        "ok": True,
        "total_csv": len(rows),
        "total_matched": len(matched),
        "total_unmatched": len(unmatched),
        "matched": matched,
        "unmatched": unmatched,
        "ad_sync": sync_ad,
        "ad_token_ok": graph_token is not None if sync_ad else None,
    })
