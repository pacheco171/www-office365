"""Blueprint: /api/reports/* e /api/debug/exchange-columns"""

import concurrent.futures

from flask import Blueprint, request, jsonify

from app.auth_service import require_role
from app.utils import log
from app.graph_service import load_graph_config, graph_get_token, graph_get_csv_report, graph_get_simple, graph_get_paginated, get_csv_field
from app.config import http_requests

bp = Blueprint("reports", __name__)


# ── Helpers locais ────────────────────────────────────────────────────────────

def _extract_archive_fields(row: dict) -> tuple:
    has_archive = False
    archive_b = "0"
    archive_items = "0"
    for key in row.keys():
        kl = key.lower().strip()
        val = (row.get(key) or "").strip()
        if not val or ("archive" not in kl and "arquivo" not in kl):
            continue
        is_storage = "storage" in kl or ("used" in kl and "byte" in kl) or "armazenamento" in kl
        is_item = ("item" in kl or "iten" in kl) and ("count" in kl or "contagem" in kl)
        is_has = kl.startswith("has") or kl.startswith("tem") or kl.startswith("possui")
        if is_storage:
            archive_b = val
        elif is_item:
            archive_items = val
        elif is_has:
            has_archive = val.lower() in ("yes", "true", "1", "sim")
    if not has_archive and archive_b not in ("0", ""):
        try:
            has_archive = int(archive_b) > 0
        except (ValueError, TypeError):
            pass
    return has_archive, archive_b, archive_items


def _fetch_archive_sizes_batch(token: str, user_emails: list) -> dict:
    if not user_emails or not http_requests:
        return {}
    result = {}
    batch_size = 20
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    for i in range(0, len(user_emails), batch_size):
        batch = user_emails[i:i + batch_size]
        requests_payload = [
            {"id": str(j), "method": "GET", "url": f"/users/{email}/mailFolders/archive"}
            for j, email in enumerate(batch)
        ]
        try:
            resp = http_requests.post(
                "https://graph.microsoft.com/beta/$batch",
                headers=headers,
                json={"requests": requests_payload},
                timeout=30,
            )
            if not resp.ok:
                log.warning("Archive batch falhou: %s %s", resp.status_code, resp.text[:200])
                break
            for item in resp.json().get("responses", []):
                if item.get("status") == 200:
                    idx = int(item["id"])
                    body = item.get("body", {})
                    result[batch[idx].lower()] = {
                        "sizeInBytes": body.get("sizeInBytes", 0) or 0,
                        "totalItemCount": body.get("totalItemCount", 0) or 0,
                    }
        except Exception:
            log.exception("Erro ao buscar archive sizes batch")
            break
    return result


def _require_graph_cfg(tid: str):
    """Retorna (cfg, None) se válido, ou (None, response_erro) se inválido."""
    cfg = load_graph_config(tid)
    if not cfg.get("tenant_id") or not cfg.get("client_id") or not cfg.get("client_secret"):
        return None, (jsonify({"error": "Graph API não configurada. Acesse Config para definir as credenciais."}), 400)
    return cfg, None


# ── Rotas ─────────────────────────────────────────────────────────────────────

@bp.route("/api/debug/exchange-columns", methods=["GET"])
def debug_exchange_columns():
    check = require_role("admin", "superadmin")
    if check:
        return check
    tid = getattr(request, "tenant_id", "live")
    cfg, err = _require_graph_cfg(tid)
    if err:
        return err
    try:
        token = graph_get_token(cfg)
        rows = graph_get_csv_report(token, "https://graph.microsoft.com/v1.0/reports/getMailboxUsageDetail(period='D7')")
        if not rows:
            return jsonify({"columns": [], "sample": None, "total_rows": 0})
        sample = dict(rows[0])
        archive_cols = {k: v for k, v in sample.items() if "archive" in k.lower() or "arquivo" in k.lower()}
        return jsonify({
            "total_rows": len(rows),
            "columns": list(rows[0].keys()),
            "archive_columns": archive_cols,
            "sample_user": {
                "displayName": sample.get("Display Name", ""),
                "hasArchive": sample.get("Has Archive", ""),
                "archiveStorage": sample.get("Archive Mailbox Storage Used (Byte)", "N/A"),
                "archiveItems": sample.get("Archive Mailbox Item Count", "N/A"),
            }
        })
    except Exception as e:
        log.exception("Erro ao diagnosticar colunas Exchange")
        return jsonify({"error": str(e)}), 500


@bp.route("/api/reports/exchange", methods=["GET"])
def report_exchange():
    check = require_role("viewer", "admin", "superadmin")
    if check:
        return check
    tid = getattr(request, "tenant_id", "live")
    cfg, err = _require_graph_cfg(tid)
    if err:
        return err
    try:
        token = graph_get_token(cfg)
        rows = graph_get_csv_report(token, "https://graph.microsoft.com/v1.0/reports/getMailboxUsageDetail(period='D7')")
        data = []
        for row in rows:
            email = get_csv_field(row, "User Principal Name", "user principal name") or ""
            display = get_csv_field(row, "Display Name", "display name") or email.split("@")[0]
            storage_b = get_csv_field(row, "Storage Used (Byte)", "storage used (byte)") or "0"
            items = get_csv_field(row, "Item Count", "item count") or "0"
            last_act = get_csv_field(row, "Last Activity Date", "last activity date") or ""
            warn_q = get_csv_field(row, "Issue Warning Quota (Byte)", "issue warning quota (byte)") or "0"
            send_q = get_csv_field(row, "Prohibit Send Quota (Byte)", "prohibit send quota (byte)") or "0"
            try:
                storage_mb = round(int(storage_b) / 1048576, 1)
            except (ValueError, TypeError):
                storage_mb = 0
            try:
                quota_bytes = int(send_q) if int(send_q) > 0 else int(warn_q)
            except (ValueError, TypeError):
                quota_bytes = 0
            quota_pct = round(int(storage_b) / quota_bytes * 100, 1) if quota_bytes > 0 else 0
            quota_status = "Normal" if quota_pct < 80 else ("Warning" if quota_pct < 95 else "Crítico")
            if last_act and last_act.lower() in ("", "never"):
                last_act = ""
            has_archive, archive_b, archive_items_raw = _extract_archive_fields(row)
            try:
                archive_mb = round(int(archive_b) / 1048576, 1)
            except (ValueError, TypeError):
                archive_mb = 0
            try:
                archive_item_count = int(archive_items_raw)
            except (ValueError, TypeError):
                archive_item_count = 0
            data.append({
                "email": email.strip(), "displayName": display.strip(),
                "storageMB": storage_mb, "itemCount": int(items) if items.isdigit() else 0,
                "lastActivity": last_act.strip(), "quotaPct": quota_pct, "quotaStatus": quota_status,
                "hasArchive": has_archive, "archiveMB": archive_mb, "archiveItemCount": archive_item_count,
            })
        archive_emails = [r["email"] for r in data if r["hasArchive"] and r["email"]]
        archive_sizes = _fetch_archive_sizes_batch(token, archive_emails)
        if archive_sizes:
            for r in data:
                info = archive_sizes.get(r["email"].lower())
                if info:
                    r["archiveMB"] = round(info["sizeInBytes"] / 1048576, 1)
                    r["archiveItemCount"] = info["totalItemCount"]
        return jsonify({"data": data})
    except Exception as e:
        log.exception("Erro ao obter relatório Exchange D-7")
        return jsonify({"error": f"Falha ao obter dados: {e}"}), 500


@bp.route("/api/reports/onedrive", methods=["GET"])
def report_onedrive():
    check = require_role("viewer", "admin", "superadmin")
    if check:
        return check
    tid = getattr(request, "tenant_id", "live")
    cfg, err = _require_graph_cfg(tid)
    if err:
        return err
    try:
        token = graph_get_token(cfg)
        rows = graph_get_csv_report(token, "https://graph.microsoft.com/v1.0/reports/getOneDriveUsageAccountDetail(period='D7')")
        data = []
        for row in rows:
            email = get_csv_field(row, "Owner Principal Name", "owner principal name") or ""
            display = get_csv_field(row, "Owner Display Name", "owner display name") or email.split("@")[0]
            storage_b = get_csv_field(row, "Storage Used (Byte)", "storage used (byte)") or "0"
            files = get_csv_field(row, "File Count", "file count") or "0"
            active_files = get_csv_field(row, "Active File Count", "active file count") or "0"
            last_act = get_csv_field(row, "Last Activity Date", "last activity date") or ""
            site_url = get_csv_field(row, "Site URL", "site url") or ""
            try:
                storage_mb = round(int(storage_b) / 1048576, 1)
            except (ValueError, TypeError):
                storage_mb = 0
            if last_act and last_act.lower() in ("", "never"):
                last_act = ""
            data.append({
                "email": email.strip(), "displayName": display.strip(),
                "storageMB": storage_mb, "fileCount": int(files) if files.isdigit() else 0,
                "activeFileCount": int(active_files) if active_files.isdigit() else 0,
                "lastActivity": last_act.strip(), "siteUrl": site_url.strip(),
            })
        return jsonify({"data": data})
    except Exception as e:
        log.exception("Erro ao obter relatório OneDrive D-7")
        return jsonify({"error": f"Falha ao obter dados: {e}"}), 500


@bp.route("/api/reports/domains", methods=["GET"])
def report_domains():
    check = require_role("viewer", "admin", "superadmin")
    if check:
        return check
    tid = getattr(request, "tenant_id", "live")
    cfg, err = _require_graph_cfg(tid)
    if err:
        return err
    try:
        token = graph_get_token(cfg)
        domains = graph_get_simple(token, "https://graph.microsoft.com/v1.0/domains")
        data = [{"id": d.get("id", ""), "authType": d.get("authenticationType", "Managed"),
                 "isDefault": d.get("isDefault", False), "isVerified": d.get("isVerified", False),
                 "services": d.get("supportedServices", [])} for d in domains]
        return jsonify({"data": data})
    except Exception as e:
        log.exception("Erro ao obter domínios")
        return jsonify({"error": f"Falha ao obter dados: {e}"}), 500


@bp.route("/api/reports/groups", methods=["GET"])
def report_groups():
    check = require_role("viewer", "admin", "superadmin")
    if check:
        return check
    tid = getattr(request, "tenant_id", "live")
    cfg, err = _require_graph_cfg(tid)
    if err:
        return err
    try:
        token = graph_get_token(cfg)
        groups = graph_get_paginated(
            token, "https://graph.microsoft.com/v1.0/groups",
            {"$select": "id,displayName,description,groupTypes,mailEnabled,securityEnabled,createdDateTime", "$top": "999"},
        )

        def _fetch_member_count(group_id):
            try:
                resp = http_requests.get(
                    f"https://graph.microsoft.com/v1.0/groups/{group_id}/members/$count",
                    headers={"Authorization": f"Bearer {token}", "ConsistencyLevel": "eventual"},
                    params={"$count": "true"}, timeout=10,
                )
                if resp.ok:
                    return int(resp.text.strip())
                log.warning("memberCount falhou para %s: HTTP %s", group_id, resp.status_code)
            except Exception as exc:
                log.warning("memberCount exception para %s: %s", group_id, exc)
            return None

        group_ids = [g.get("id", "") for g in groups]
        counts = {}
        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
            future_map = {executor.submit(_fetch_member_count, gid): gid for gid in group_ids}
            for future in concurrent.futures.as_completed(future_map):
                counts[future_map[future]] = future.result()

        data = [{
            "id": g.get("id", ""), "displayName": g.get("displayName", ""),
            "description": g.get("description", ""), "groupTypes": g.get("groupTypes", []),
            "mailEnabled": g.get("mailEnabled", False), "securityEnabled": g.get("securityEnabled", False),
            "createdDateTime": g.get("createdDateTime", ""), "memberCount": counts.get(g.get("id", "")),
        } for g in groups]
        return jsonify({"data": data})
    except Exception as e:
        log.exception("Erro ao obter grupos")
        return jsonify({"error": f"Falha ao obter dados: {e}"}), 500


@bp.route("/api/reports/groups/<group_id>/members", methods=["GET"])
def report_group_members(group_id):
    check = require_role("viewer", "admin", "superadmin")
    if check:
        return check
    tid = getattr(request, "tenant_id", "live")
    cfg, err = _require_graph_cfg(tid)
    if err:
        return err
    try:
        token = graph_get_token(cfg)
        members = graph_get_paginated(
            token, f"https://graph.microsoft.com/v1.0/groups/{group_id}/members",
            {"$select": "id,displayName,userPrincipalName", "$top": "999"},
        )
        data = [{"id": m.get("id", ""), "displayName": m.get("displayName", ""),
                 "email": m.get("userPrincipalName", "")} for m in members]
        return jsonify({"data": data})
    except Exception as e:
        log.exception("Erro ao obter membros do grupo")
        return jsonify({"error": f"Falha ao obter dados: {e}"}), 500


@bp.route("/api/reports/applications", methods=["GET"])
def report_applications():
    check = require_role("viewer", "admin", "superadmin")
    if check:
        return check
    tid = getattr(request, "tenant_id", "live")
    cfg, err = _require_graph_cfg(tid)
    if err:
        return err
    try:
        token = graph_get_token(cfg)
        apps = graph_get_paginated(
            token, "https://graph.microsoft.com/v1.0/applications",
            {"$select": "id,displayName,appId,createdDateTime,signInAudience", "$top": "999"},
        )
        data = [{"id": a.get("id", ""), "displayName": a.get("displayName", ""),
                 "appId": a.get("appId", ""), "createdDateTime": a.get("createdDateTime", ""),
                 "signInAudience": a.get("signInAudience", "")} for a in apps]
        return jsonify({"data": data})
    except Exception as e:
        log.exception("Erro ao obter applications")
        return jsonify({"error": f"Falha ao obter dados: {e}"}), 500


@bp.route("/api/reports/service-principals", methods=["GET"])
def report_service_principals():
    check = require_role("viewer", "admin", "superadmin")
    if check:
        return check
    tid = getattr(request, "tenant_id", "live")
    cfg, err = _require_graph_cfg(tid)
    if err:
        return err
    try:
        token = graph_get_token(cfg)
        sps = graph_get_paginated(
            token, "https://graph.microsoft.com/v1.0/servicePrincipals",
            {"$select": "id,displayName,appId,servicePrincipalType,accountEnabled,createdDateTime,appOwnerOrganizationId", "$top": "999"},
        )
        data = [{"id": sp.get("id", ""), "displayName": sp.get("displayName", ""),
                 "appId": sp.get("appId", ""), "spType": sp.get("servicePrincipalType", "Application"),
                 "accountEnabled": sp.get("accountEnabled", True),
                 "createdDateTime": sp.get("createdDateTime", ""),
                 "appOwnerOrgId": sp.get("appOwnerOrganizationId", "")} for sp in sps]
        return jsonify({"data": data})
    except Exception as e:
        log.exception("Erro ao obter service principals")
        return jsonify({"error": f"Falha ao obter dados: {e}"}), 500


@bp.route("/api/reports/privileged-users", methods=["GET"])
def report_privileged_users():
    check = require_role("viewer", "admin", "superadmin")
    if check:
        return check
    tid = getattr(request, "tenant_id", "live")
    cfg, err = _require_graph_cfg(tid)
    if err:
        return err
    try:
        token = graph_get_token(cfg)
        dir_roles = graph_get_simple(token, "https://graph.microsoft.com/v1.0/directoryRoles?$select=id,displayName,description")
        roles_data = []
        for role in dir_roles:
            try:
                members = graph_get_paginated(token, f"https://graph.microsoft.com/v1.0/directoryRoles/{role['id']}/members", {"$top": "999"})
            except Exception as member_err:
                status_code = getattr(getattr(member_err, "response", None), "status_code", None)
                if status_code in (400, 404):
                    members = []
                else:
                    raise
            roles_data.append({
                "id": role.get("id", ""), "displayName": role.get("displayName", ""),
                "description": role.get("description", ""),
                "members": [{"id": m.get("id", ""), "displayName": m.get("displayName", ""),
                              "email": m.get("userPrincipalName") or m.get("mail") or ""} for m in members],
            })
        return jsonify({"data": {"roles": roles_data}})
    except Exception as e:
        status_code = getattr(getattr(e, "response", None), "status_code", None)
        log.exception("Erro ao obter usuários privilegiados")
        if status_code == 400:
            return jsonify({"error": "Não foi possível carregar membros. Verifique as permissões no Azure AD."}), 400
        return jsonify({"error": "Erro ao carregar dados de privilégios. Tente atualizar a página."}), 500


@bp.route("/api/reports/policies", methods=["GET"])
def report_policies():
    check = require_role("viewer", "admin", "superadmin")
    if check:
        return check
    tid = getattr(request, "tenant_id", "live")
    cfg, err = _require_graph_cfg(tid)
    if err:
        return err
    try:
        token = graph_get_token(cfg)
        policies = graph_get_paginated(token, "https://graph.microsoft.com/v1.0/identity/conditionalAccess/policies", {"$top": "999"})
        data = []
        for p in policies:
            conditions = p.get("conditions") or {}
            grant = p.get("grantControls") or {}
            users_obj = conditions.get("users") or {}
            users_inc = users_obj.get("includeUsers") or []
            users_grp = users_obj.get("includeGroups") or []
            user_scope = (f"{len(users_inc)} usuário(s)" if users_inc and users_inc != ["All"]
                          else f"{len(users_grp)} grupo(s)" if users_grp else "Todos")
            apps_obj = conditions.get("applications") or {}
            apps_inc = apps_obj.get("includeApplications") or []
            app_scope = f"{len(apps_inc)} app(s)" if apps_inc and apps_inc != ["All"] else "Todos"
            cond_list = []
            if conditions.get("locations", {}).get("includeLocations"):
                cond_list.append("Localização")
            if conditions.get("platforms", {}).get("includePlatforms"):
                cond_list.append("Plataforma")
            if conditions.get("signInRiskLevels"):
                cond_list.append("Risco de Login")
            if conditions.get("userRiskLevels"):
                cond_list.append("Risco Usuário")
            if conditions.get("clientAppTypes") and conditions["clientAppTypes"] != ["all"]:
                cond_list.append("Tipo de Aplicativo")
            data.append({
                "id": p.get("id", ""), "displayName": p.get("displayName", ""),
                "state": p.get("state", "disabled"), "userScope": user_scope,
                "appScope": app_scope, "grantControls": (grant.get("builtInControls") or []) if grant else [],
                "conditions": cond_list,
            })
        return jsonify({"data": data})
    except Exception as e:
        log.exception("Erro ao obter políticas de acesso")
        return jsonify({"error": f"Falha ao obter dados: {e}"}), 500
