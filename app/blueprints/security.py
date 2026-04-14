"""Blueprint: /api/security/*"""

from flask import Blueprint, request, jsonify

from app.auth_service import require_role
from app.config import http_requests
from app.utils import log, load_data
from app.licenses import compute_cost
from app.graph_service import load_graph_config, graph_get_token, graph_get_paginated, graph_get_simple, _GRAPH_LANG_HEADERS

bp = Blueprint("security", __name__)


@bp.route("/api/security/alerts", methods=["GET"])
def security_alerts():
    check = require_role("viewer", "admin", "superadmin")
    if check:
        return check
    tid = getattr(request, "tenant_id", "live")
    cfg = load_graph_config(tid)
    if not cfg.get("tenant_id") or not cfg.get("client_id") or not cfg.get("client_secret"):
        return jsonify({"error": "Graph API não configurada."}), 400
    try:
        token = graph_get_token(cfg)
        data = []
        try:
            alerts = graph_get_paginated(
                token, "https://graph.microsoft.com/v1.0/security/alerts",
                {"$top": "100", "$orderby": "createdDateTime desc"},
            )
            for a in alerts:
                data.append({
                    "id": a.get("id", ""),
                    "title": a.get("title", (a.get("alertDetections") or [{}])[0].get("title", "") if a.get("alertDetections") else ""),
                    "description": a.get("description", ""),
                    "severity": a.get("severity", "informational"),
                    "status": a.get("status", "unknown"),
                    "createdDateTime": a.get("createdDateTime", ""),
                    "category": a.get("category", ""),
                })
        except Exception as e:
            if "403" in str(e) or "Forbidden" in str(e):
                return jsonify({"error": "Permissão SecurityEvents.Read.All não concedida no Azure AD."})
            raise
        return jsonify({"data": data})
    except Exception as e:
        log.exception("Erro ao obter alertas de segurança")
        return jsonify({"error": f"Falha ao obter alertas: {e}"}), 500


@bp.route("/api/security/analysis", methods=["GET"])
def security_analysis():
    check = require_role("viewer", "admin", "superadmin")
    if check:
        return check

    result = {"noMfa": [], "staleAccounts": [], "adminsNoMfa": [], "failedSignIns": [], "blockedWithLicense": []}

    tid = getattr(request, "tenant_id", "live")
    raw = load_data(tid)
    db_local = raw.get("db", []) if isinstance(raw, dict) else raw
    usage_local = raw.get("usage", {}) if isinstance(raw, dict) else {}
    db_by_email = {r.get("email", "").lower(): r for r in db_local}

    for r in db_local:
        lic_id = r.get("licId", "none")
        if r.get("status") == "Inativo" and lic_id != "none":
            result["blockedWithLicense"].append({
                "displayName": r.get("nome", ""), "email": r.get("email", ""),
                "licId": lic_id, "custo": compute_cost(lic_id, r.get("addons")),
                "setor": r.get("setor", ""), "cargo": r.get("cargo", ""),
            })

    for r in db_local:
        if r.get("status") == "Ativo":
            email = r.get("email", "").lower()
            last = (usage_local.get(email) or {}).get("lastActivity", "")
            if last:
                try:
                    from datetime import datetime
                    dias = (datetime.now() - datetime.strptime(last, "%Y-%m-%d")).days
                    if dias > 90:
                        lic_id = r.get("licId", "none")
                        result["staleAccounts"].append({
                            "displayName": r.get("nome", ""), "email": email,
                            "lastActivity": last, "diasInativo": dias,
                            "setor": r.get("setor", ""), "cargo": r.get("cargo", ""),
                            "licId": lic_id, "custo": compute_cost(lic_id, r.get("addons")),
                        })
                except Exception:
                    pass

    cfg = load_graph_config(tid)
    if cfg.get("tenant_id") and cfg.get("client_id") and cfg.get("client_secret"):
        try:
            token = graph_get_token(cfg)
        except Exception as e:
            log.warning("Falha ao obter token para análise: %s", e)
            return jsonify({"data": result})

        headers = {"Authorization": f"Bearer {token}", "ConsistencyLevel": "eventual", **_GRAPH_LANG_HEADERS}

        try:
            resp = http_requests.get(
                "https://graph.microsoft.com/beta/reports/credentialUserRegistrationDetails",
                headers=headers, params={"$top": "999"}, timeout=15,
            )
            if resp.ok:
                for cr in resp.json().get("value", []):
                    if not cr.get("isMfaRegistered", True):
                        email = cr.get("userPrincipalName", "").lower()
                        db_user = db_by_email.get(email, {})
                        result["noMfa"].append({
                            "displayName": cr.get("userDisplayName", "") or db_user.get("nome", ""),
                            "email": email, "setor": db_user.get("setor", ""),
                            "cargo": db_user.get("cargo", ""),
                        })
        except Exception as e:
            log.warning("MFA check pulado: %s", e)

        try:
            resp = http_requests.get(
                "https://graph.microsoft.com/v1.0/auditLogs/signIns",
                headers=headers,
                params={"$filter": "status/errorCode ne 0", "$top": "50", "$orderby": "createdDateTime desc"},
                timeout=15,
            )
            if resp.ok:
                seen = set()
                for si in resp.json().get("value", []):
                    email = si.get("userPrincipalName", "")
                    if email and email not in seen:
                        seen.add(email)
                        status = si.get("status", {})
                        created = si.get("createdDateTime", "")
                        result["failedSignIns"].append({
                            "displayName": si.get("userDisplayName", ""), "email": email,
                            "motivo": status.get("failureReason", "") or status.get("additionalDetails", ""),
                            "errorCode": status.get("errorCode", ""),
                            "data": created.split("T")[0] if created else "",
                        })
        except Exception as e:
            log.warning("Sign-ins check pulado: %s", e)

    return jsonify({"data": result})


@bp.route("/api/security/secure-score", methods=["GET"])
def secure_score():
    check = require_role("viewer", "admin", "superadmin")
    if check:
        return check
    tid = getattr(request, "tenant_id", "live")
    cfg = load_graph_config(tid)
    if not cfg.get("tenant_id") or not cfg.get("client_id") or not cfg.get("client_secret"):
        return jsonify({"error": "Graph API não configurada."}), 400
    try:
        token = graph_get_token(cfg)
        scores = graph_get_simple(token, "https://graph.microsoft.com/v1.0/security/secureScores?$top=1")
        if not scores:
            return jsonify({"data": {"currentScore": 0, "maxScore": 100, "controlScores": [], "averageComparativeScores": []}})
        s = scores[0] if isinstance(scores, list) else scores
        return jsonify({"data": {
            "currentScore": s.get("currentScore", 0), "maxScore": s.get("maxScore", 100),
            "controlScores": s.get("controlScores", []),
            "averageComparativeScores": s.get("averageComparativeScores", []),
        }})
    except Exception as e:
        log.exception("Erro ao obter Secure Score")
        return jsonify({"error": f"Falha ao obter dados: {e}"}), 500


@bp.route("/api/security/score-profiles", methods=["GET"])
def secure_score_profiles():
    check = require_role("viewer", "admin", "superadmin")
    if check:
        return check
    tid = getattr(request, "tenant_id", "live")
    cfg = load_graph_config(tid)
    if not cfg.get("tenant_id") or not cfg.get("client_id") or not cfg.get("client_secret"):
        return jsonify({"error": "Graph API não configurada."}), 400
    try:
        token = graph_get_token(cfg)
        profiles = graph_get_paginated(token, "https://graph.microsoft.com/v1.0/security/secureScoreControlProfiles", {"$top": "999"})
        data = [{
            "controlName": p.get("id", ""), "title": p.get("title", ""),
            "description": p.get("implementationCost", ""),
            "controlCategory": p.get("controlCategory", ""),
            "maxScore": p.get("maxScore", 0), "rank": p.get("rank", 999),
            "deprecated": p.get("deprecated", False), "remediation": p.get("remediation", ""),
        } for p in profiles]
        return jsonify({"data": data})
    except Exception as e:
        log.exception("Erro ao obter Secure Score profiles")
        return jsonify({"error": f"Falha ao obter dados: {e}"}), 500
