"""Serviço de integração com Microsoft Graph API.

Contém: obtenção de token, paginação, processamento de usuários, sync completo.
"""

import csv
import io
import re
import time
import logging
import threading
import unicodedata
from datetime import datetime, timezone

from app.config import http_requests
from app.crypto import decrypt_secret, encrypt_secret
from app.licenses import SKU_MAP, LIC_NAME_MAP, LIC_PRIORITY, compute_cost
from app.utils import (
    log, tenant_path, load_json_safe, save_json_atomic,
    get_tenant_lock, load_data, save_data, load_overrides, apply_overrides,
    _sync_status, _sync_threads,
)

# ── Constantes de normalização ────────────────────────────────────────────────

SETOR_NORMALIZE = {
    "ecommerce": "E-commerce", "ECOMMERCE": "E-commerce",
    "e-commerce": "E-commerce", "Ecommerce": "E-commerce",
    "DISTRIBUICAO": "Distribuição", "Distribiuição": "Distribuição",
    "Distribuicao": "Distribuição", "DOBRACAO": "Dobração",
    "Dobracao": "Dobração", "ENGENHARIA": "Engenharia",
    "ENGENHARIA DE PROCESSOS": "Engenharia de Processos",
    "Engenharia Processos": "Engenharia de Processos",
    "Expedicao": "Expedição", "EXPEDICAO": "Expedição", "EXPEDIÇÃO": "Expedição",
    "Manutencao": "Manutenção", "MANUTENCAO": "Manutenção",
    "SUPERVISORES": "Supervisores", "MODELAGEM": "Modelagem",
    "EVENTOS": "Eventos", "EXPANSAO": "Expansão", "EXPORTACAO": "Exportação",
    "Logistica": "Logística", "LOGISTICA": "Logística",
    "Juridico": "Jurídico", "JURIDICO": "Jurídico",
    "Financeiro Lojas": "Financeiro", "Qualidade LIVE!": "Qualidade",
    "Depto Malharia": "Malharia",
    "Depto Recursos Humanos Varejo": "RH",
    "Diretoria Presidente": "Diretoria",
    "Acabamento Textil": "Acabamento Têxtil",
    "ACABAMENTO TEXTIL": "Acabamento Têxtil",
    "Textil": "Têxtil", "TEXTIL": "Têxtil", "Têxtil Seamless": "Têxtil",
    "Almoxarifado Tecidos": "Almoxarifado",
    "Expansao": "Expansão", "Gente Gestao": "Gente e Gestão",
    "Gente Gestão": "Gente e Gestão", "Exportacao": "Exportação",
    "Servicos": "Serviços", "Serviço": "Serviços", "PCP": "PPCP",
}

DEPT_SEPARATORS = [" - ", " / ", " > ", " | ", " \\ ", " – ", " — "]

NAME_SUFFIX_RE = re.compile(
    r"^(.+?)\s+-\s+([A-ZÀ-ÚÇa-zà-úç][A-ZÀ-ÚÇa-zà-úç0-9&!.\- ]*?)$"
)
LOJA_RE = re.compile(r"^L\d{3}\b", re.IGNORECASE)

IGNORED_OUS = {
    "usuarios", "usuários", "usuario", "usuário",
    "users", "user", "domain controllers", "computers",
    "builtin", "managed service accounts", "teste-cmd",
}

_GRAPH_LANG_HEADERS = {"Accept-Language": "pt-BR", "Prefer": 'outlook.language="pt-BR"'}


# ── Configuração do Graph ─────────────────────────────────────────────────────

def load_graph_config(tenant_id: str = "live") -> dict:
    cfg = load_json_safe(
        tenant_path(tenant_id, "graph_config.json"),
        {"tenant_id": "", "client_id": "", "client_secret": "", "domain": "liveoficial.com.br",
         "ou_root": "Setores", "auto_sync": False, "sync_interval_hours": 24},
    )
    import os
    for field in ("client_secret", "tenant_id", "client_id"):
        if cfg.get(field) and isinstance(cfg[field], str) and cfg[field].startswith("enc:"):
            cfg[field] = decrypt_secret(cfg[field])
    suffix = "_" + tenant_id.upper()
    for env_key, cfg_key in [
        ("GRAPH_CLIENT_SECRET", "client_secret"),
        ("GRAPH_TENANT_ID", "tenant_id"),
        ("GRAPH_CLIENT_ID", "client_id"),
    ]:
        val = os.environ.get(env_key + suffix, "") or os.environ.get(env_key, "")
        if val:
            cfg[cfg_key] = val
    if cfg.get("ai_api_key") and isinstance(cfg["ai_api_key"], str) and cfg["ai_api_key"].startswith("enc:"):
        cfg["ai_api_key"] = decrypt_secret(cfg["ai_api_key"])
    ai_key = os.environ.get("ANTHROPIC_API_KEY" + suffix, "") or os.environ.get("ANTHROPIC_API_KEY", "")
    if ai_key:
        cfg["ai_api_key"] = ai_key
    return cfg


def save_graph_config(cfg: dict, tenant_id: str = "live"):
    import os
    safe_cfg = dict(cfg)
    suffix = "_" + tenant_id.upper()
    for env_key, cfg_key in [
        ("GRAPH_CLIENT_SECRET", "client_secret"),
        ("GRAPH_TENANT_ID", "tenant_id"),
        ("GRAPH_CLIENT_ID", "client_id"),
    ]:
        if os.environ.get(env_key + suffix) or os.environ.get(env_key):
            safe_cfg.pop(cfg_key, None)
    if os.environ.get("ANTHROPIC_API_KEY" + suffix) or os.environ.get("ANTHROPIC_API_KEY"):
        safe_cfg.pop("ai_api_key", None)
    for field in ("client_secret", "tenant_id", "client_id", "ai_api_key"):
        if safe_cfg.get(field) and not safe_cfg[field].startswith("enc:"):
            safe_cfg[field] = encrypt_secret(safe_cfg[field])
    save_json_atomic(tenant_path(tenant_id, "graph_config.json"), safe_cfg)


# ── HTTP helpers Graph API ────────────────────────────────────────────────────

def graph_get_token(cfg: dict) -> str:
    if not http_requests:
        raise RuntimeError("Módulo requests não instalado")
    url = f"https://login.microsoftonline.com/{cfg['tenant_id']}/oauth2/v2.0/token"
    resp = http_requests.post(
        url,
        data={
            "client_id": cfg["client_id"],
            "client_secret": cfg["client_secret"],
            "scope": "https://graph.microsoft.com/.default",
            "grant_type": "client_credentials",
        },
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()["access_token"]


def graph_get_paginated(token: str, url: str, params=None) -> list:
    headers = {"Authorization": f"Bearer {token}", "ConsistencyLevel": "eventual", **_GRAPH_LANG_HEADERS}
    results = []
    while url:
        resp = http_requests.get(url, headers=headers, params=params, timeout=60)
        resp.raise_for_status()
        data = resp.json()
        results.extend(data.get("value", []))
        url = data.get("@odata.nextLink")
        params = None
    return results


def graph_get_simple(token: str, url: str) -> list:
    headers = {"Authorization": f"Bearer {token}", **_GRAPH_LANG_HEADERS}
    resp = http_requests.get(url, headers=headers, timeout=60)
    if not resp.ok:
        log.error("Graph API erro %s %s: %s", resp.status_code, url, resp.text[:500])
    resp.raise_for_status()
    data = resp.json()
    return data.get("value", data if isinstance(data, list) else [])


def graph_post(token: str, url: str, payload: dict) -> dict:
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        **_GRAPH_LANG_HEADERS,
    }
    resp = http_requests.post(url, headers=headers, json=payload, timeout=30)
    if not resp.ok:
        log.error("Graph API POST erro %s %s: %s", resp.status_code, url, resp.text[:500])
    resp.raise_for_status()
    if resp.status_code == 204 or not resp.content:
        return {}
    try:
        return resp.json()
    except ValueError:
        return {}


def resolve_sku_ids_for_lic(lic_id: str, addons: list, subscriptions: list) -> set:
    if not subscriptions:
        return set()
    wanted = set()
    keys = set()
    if lic_id and lic_id not in ("none", "other"):
        keys.add(lic_id)
    for a in addons or []:
        if a:
            keys.add(a)
    for s in subscriptions:
        if s.get("licId") in keys and s.get("skuId"):
            wanted.add(s["skuId"])
    return wanted


def assign_license_for_user(token: str, user_email: str, target_sku_ids: set, managed_sku_ids: set) -> dict:
    user_url = f"https://graph.microsoft.com/v1.0/users/{user_email}"
    headers = {"Authorization": f"Bearer {token}", **_GRAPH_LANG_HEADERS}
    resp = http_requests.get(user_url + "?$select=id,assignedLicenses", headers=headers, timeout=30)
    if not resp.ok:
        log.error("Graph GET user %s falhou %s: %s", user_email, resp.status_code, resp.text[:500])
    resp.raise_for_status()
    user = resp.json()
    current = {a.get("skuId") for a in (user.get("assignedLicenses") or []) if a.get("skuId")}
    current_managed = current & managed_sku_ids
    add = sorted(target_sku_ids - current)
    remove = sorted(current_managed - target_sku_ids)
    if not add and not remove:
        return {"added": [], "removed": [], "noop": True}
    payload = {
        "addLicenses": [{"skuId": sid, "disabledPlans": []} for sid in add],
        "removeLicenses": remove,
    }
    graph_post(token, f"{user_url}/assignLicense", payload)
    return {"added": add, "removed": remove, "noop": False}


def graph_get_csv_report(token: str, url: str) -> list:
    headers = {"Authorization": f"Bearer {token}"}
    resp = http_requests.get(url, headers=headers, timeout=120)
    resp.raise_for_status()
    text = resp.text.lstrip("\ufeff")
    lines = text.splitlines()
    while lines and "," not in lines[0]:
        lines.pop(0)
    if not lines:
        return []
    return list(csv.DictReader(io.StringIO("\n".join(lines))))


# ── Processamento de usuários ─────────────────────────────────────────────────

def _norm_setor(s: str) -> str:
    return SETOR_NORMALIZE.get(s, s)


def _parse_ou_dn(dn: str, ou_root: str = "Setores"):
    if not dn:
        return None, None, None
    ous = []
    for part in dn.split(","):
        part = part.strip()
        if part.upper().startswith("OU="):
            val = part[3:]
            if val.lower() not in IGNORED_OUS:
                ous.append(val)
    if not ous:
        return None, None, None
    ou_root_lower = (ou_root or "").lower()
    if ou_root_lower:
        root_idx = next((i for i in range(len(ous) - 1, -1, -1) if ous[i].lower() == ou_root_lower), None)
        if root_idx is None:
            return None, None, None
        ous = ous[:root_idx]
    if not ous:
        return None, None, None
    ous = ous[:-1]  # remove divisão (mais externo)
    if not ous:
        return None, None, None
    if len(ous) == 1:
        return _norm_setor(ous[0]), None, None
    elif len(ous) == 2:
        return _norm_setor(ous[-1]), ous[0], None
    else:
        return _norm_setor(ous[-1]), ous[-2], ous[0]


def _parse_dept(dept: str):
    if not dept:
        return "Sem Setor", None
    dept = dept.strip()
    for sep in DEPT_SEPARATORS:
        pos = dept.find(sep)
        if pos > 0:
            macro = dept[:pos].strip()
            area = dept[pos + len(sep):].strip()
            if macro and area:
                return _norm_setor(macro), area
    return _norm_setor(dept), None


def _clean_display_name(name: str):
    if not name:
        return name, None
    if LOJA_RE.match(name) or "Placa:" in name:
        return name, None
    m = NAME_SUFFIX_RE.match(name)
    if m:
        return m.group(1).strip(), m.group(2).strip()
    return name, None


def _classify_account(nome: str, email: str) -> str:
    prefix = email.split("@")[0]
    nome_l = (nome or "").lower()
    if re.match(r"^L\d{3}\b", nome or ""):
        return "Loja"
    if "sala " in nome_l or nome_l.startswith("sala"):
        return "Sala"
    if "live!" in nome_l:
        return "Compartilhado"
    for kw in ("agenda ", "scanner", "impressora", "fax", "noreply", "no-reply", "alertas ", "carro "):
        if kw in nome_l:
            return "Servico"
    if "." not in prefix and " " not in (nome or "").strip():
        return "Compartilhado"
    if " " not in (nome or "").strip():
        return "Compartilhado"
    return "Pessoa"


def resolve_lic(assigned_licenses: list, sku_names: list) -> tuple:
    addon_skus = {"pbi", "apps", "planner1", "planner3"}
    addon_ids = set()
    main_ids = set()
    for sku in sku_names:
        sku_upper = sku.upper().replace(" ", "_")
        lid = SKU_MAP.get(sku_upper)
        if not lid:
            for pattern, mapped_id in LIC_NAME_MAP:
                if pattern in sku.lower():
                    lid = mapped_id
                    break
        if not lid or lid == "_free":
            continue
        if lid in addon_skus:
            addon_ids.add(lid)
        else:
            main_ids.add(lid)
    lic_id = "none"
    for pid in LIC_PRIORITY:
        if pid in main_ids:
            lic_id = pid
            break
    if lic_id == "none" and main_ids:
        lic_id = "other"
    return lic_id, list(addon_ids), " + ".join(sku_names)


def build_subscriptions(skus: list) -> list:
    subs = []
    for s in skus:
        part = s.get("skuPartNumber", "").upper()
        lid = SKU_MAP.get(part)
        if not lid or lid == "_free":
            continue
        prep = s.get("prepaidUnits", {})
        subs.append({
            "skuId": s.get("skuId", ""),
            "skuPartNumber": s.get("skuPartNumber", ""),
            "licId": lid,
            "enabled": prep.get("enabled", 0),
            "suspended": prep.get("suspended", 0),
            "warning": prep.get("warning", 0),
            "consumed": s.get("consumedUnits", 0),
        })
    return subs


def process_graph_user(u: dict, sku_id_to_name: dict, ou_root: str = "Setores"):
    email = (u.get("userPrincipalName") or "").lower().strip()
    if not email or "#ext#" in email:
        return None
    raw_name = u.get("displayName") or email.split("@")[0]
    nome, _ = _clean_display_name(raw_name)
    dn = u.get("onPremisesDistinguishedName") or ""
    ou_setor, ou_area, ou_subarea = _parse_ou_dn(dn, ou_root)
    setor, area, subarea = (ou_setor, ou_area, ou_subarea) if ou_setor else ("Sem Setor", None, None)
    _raw_job = (u.get("jobTitle") or "").strip()
    cargo = _raw_job or "Colaborador"
    cargo_origem = "ad" if _raw_job else "fallback"
    enabled = u.get("accountEnabled", True)
    assigned = u.get("assignedLicenses") or []
    sku_names = [sku_id_to_name.get(a["skuId"], "") for a in assigned if a.get("skuId")]
    sku_names = [n for n in sku_names if n]
    lic_id, addons, lic_raw = resolve_lic(assigned, sku_names)
    return {
        "email": email, "nome": nome, "setor": setor, "area": area, "subarea": subarea,
        "cargo": cargo, "cargoOrigem": cargo_origem,
        "status": "Ativo" if enabled else "Inativo",
        "lic_id": lic_id, "addons": addons, "lic_raw": lic_raw,
        "ou_setor": ou_setor, "ou_area": ou_area, "ou_subarea": ou_subarea,
        "enabled": enabled, "created": u.get("createdDateTime", ""),
        "dn": dn, "tipo": _classify_account(nome, email),
    }


def get_csv_field(row: dict, *field_names) -> str:
    for name in field_names:
        val = row.get(name) or row.get(name.lower())
        if val:
            return val.strip()
    return ""


# ── Hierarquia ────────────────────────────────────────────────────────────────

def build_area_to_macro(hierarchy: dict) -> tuple:
    area_to_macro = {}
    macro_set = set()
    for macro, h in hierarchy.items():
        macro_set.add(macro)
        for a in (h.get("areas") or []):
            area_to_macro[a.lower()] = macro
        area_to_macro[macro.lower()] = macro
    return area_to_macro, macro_set


def resolve_hierarchy_server(setor, area, area_to_macro: dict, macro_set: set) -> tuple:
    setor = (setor or "Sem Setor").strip()
    if area and area.strip():
        return setor, area.strip()
    setor_lower = setor.lower()
    if setor_lower in area_to_macro:
        macro = area_to_macro[setor_lower]
        if setor_lower == macro.lower():
            return macro, "Geral"
        if setor in macro_set:
            return setor, "Geral"
        return macro, setor
    return setor, "Geral"


# ── Sync principal ────────────────────────────────────────────────────────────

def do_graph_sync(cfg=None, tenant_id: str = "live") -> dict:
    global _sync_status
    status = _sync_status.setdefault(tenant_id, {"running": False, "lastSync": None, "lastError": None, "lastResult": None})
    if status["running"]:
        return {"error": "Sync já em execução"}

    status["running"] = True
    status["lastError"] = None
    start = time.time()

    try:
        if not cfg:
            cfg = load_graph_config(tenant_id)
        if not cfg.get("tenant_id") or not cfg.get("client_id") or not cfg.get("client_secret"):
            raise ValueError("Credenciais Azure não configuradas")

        domain = cfg.get("domain", "liveoficial.com.br")
        ou_root = cfg.get("ou_root", "Setores")
        log.info("Iniciando sync Graph API para domínio %s", domain)

        token = graph_get_token(cfg)
        log.info("Token obtido com sucesso")

        users = graph_get_paginated(
            token, "https://graph.microsoft.com/v1.0/users",
            {"$select": "id,displayName,userPrincipalName,department,jobTitle,accountEnabled,assignedLicenses,createdDateTime,onPremisesDistinguishedName",
             "$top": "999", "$filter": f"endsWith(userPrincipalName,'@{domain}')"},
        )
        log.info("Obtidos %d usuários do Graph", len(users))

        skus = graph_get_simple(token, "https://graph.microsoft.com/v1.0/subscribedSkus")
        sku_id_to_name = {s["skuId"]: s["skuPartNumber"] for s in skus}
        subscriptions = build_subscriptions(skus)

        now_iso = datetime.now(timezone.utc).isoformat()
        now_date = now_iso[:10]
        records = []
        discovered_hierarchy = {}

        for u in users:
            result = process_graph_user(u, sku_id_to_name, ou_root)
            if not result:
                continue

            created = result["created"]
            data_iso = created[:10] if created else now_date
            demissao = now_date if not result["enabled"] else None

            ou_s = result["ou_setor"]
            ou_a = result["ou_area"]
            ou_sa = result.get("ou_subarea")
            if ou_s:
                ou_s = _norm_setor(ou_s)
                if ou_s not in discovered_hierarchy:
                    discovered_hierarchy[ou_s] = {}
                if ou_a and ou_a.lower() not in IGNORED_OUS:
                    if ou_a not in discovered_hierarchy[ou_s]:
                        discovered_hierarchy[ou_s][ou_a] = set()
                    if ou_sa and ou_sa.lower() not in IGNORED_OUS:
                        discovered_hierarchy[ou_s][ou_a].add(ou_sa)

            records.append({
                "id": hash(result["email"]) & 0x7FFFFFFF,
                "nome": result["nome"], "email": result["email"],
                "setor": result["setor"], "area": result["area"],
                "subarea": result.get("subarea"), "cargo": result["cargo"],
                "cargoOrigem": result.get("cargoOrigem", "ad"),
                "licId": result["lic_id"], "addons": result["addons"],
                "licRaw": result["lic_raw"], "status": result["status"],
                "dataISO": data_iso, "demissao": demissao,
                "setorFixo": False, "cargoFixo": False,
                "dn": result.get("dn", ""), "tipo": result.get("tipo", "Pessoa"),
            })

        log.info("Montados %d registros de usuários", len(records))

        if discovered_hierarchy:
            _update_hierarchy_from_discovery(tenant_id, discovered_hierarchy)

        for rec in records:
            rec["custo"] = compute_cost(rec["licId"], rec["addons"])

        usage = _fetch_usage_reports(token, now_iso)

        data = load_data(tenant_id)
        _preserve_demissao_dates(records, data)

        with get_tenant_lock(tenant_id, "overrides"):
            ov = load_overrides(tenant_id).get("overrides", {})
        apply_overrides(records, ov)

        with get_tenant_lock(tenant_id, "hierarchy"):
            hier_data = load_json_safe(tenant_path(tenant_id, "hierarchy.json"), {"hierarchy": {}})
            hier = hier_data.get("hierarchy", {})
        area_to_macro, macro_set = build_area_to_macro(hier)
        for rec in records:
            macro, hier_area = resolve_hierarchy_server(rec["setor"], rec.get("area"), area_to_macro, macro_set)
            rec["macro"] = macro
            rec["hierArea"] = hier_area

        data["db"] = records
        _update_snapshot(data, records, now_iso)
        data["usage"] = usage
        data["subscriptions"] = subscriptions
        save_data(data, tenant_id)

        elapsed = round(time.time() - start, 1)
        result = {
            "users": len(records),
            "mailbox_usage": len([u for u in usage.values() if "mailboxMB" in u]),
            "onedrive_usage": len([u for u in usage.values() if "onedriveMB" in u]),
            "ad_setores": len(discovered_hierarchy),
            "ad_areas": sum(len(a) for a in discovered_hierarchy.values()),
            "snapshot": datetime.now(timezone.utc).isoformat()[:7],
            "elapsed_seconds": elapsed,
        }
        status["lastSync"] = now_iso
        status["lastResult"] = result
        log.info("Sync concluído em %.1fs: %s", elapsed, result)
        return result

    except Exception as e:
        status["lastError"] = "Falha na sincronização. Verifique os logs."
        log.exception("Erro no sync")
        return {"error": "Falha na sincronização"}
    finally:
        status["running"] = False


def _preserve_demissao_dates(records: list, data: dict):
    old_demissao = {}
    for snap in sorted(data.get("snapshots", []), key=lambda s: (s.get("ano", 0), s.get("mes", 0))):
        for r in snap.get("data", []):
            em = (r.get("email") or "").lower()
            if em and r.get("demissao") and r.get("status") == "Inativo":
                old_demissao.setdefault(em, r["demissao"])
    for r in (data.get("db", []) if isinstance(data, dict) else []):
        em = (r.get("email") or "").lower()
        if em and r.get("demissao"):
            if em not in old_demissao or r["demissao"] < old_demissao[em]:
                old_demissao[em] = r["demissao"]
    for rec in records:
        if rec.get("demissao"):
            em = (rec.get("email") or "").lower()
            if em in old_demissao:
                rec["demissao"] = old_demissao[em]


def _update_snapshot(data: dict, records: list, now_iso: str):
    now = datetime.fromisoformat(now_iso.replace("Z", "+00:00"))
    mes, ano = now.month, now.year
    meses = ["", "Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"]
    label = f"{meses[mes]}/{ano}"
    snap = {"mes": mes, "ano": ano, "label": label, "data": [dict(r) for r in records]}
    snaps = data.setdefault("snapshots", [])
    idx = next((i for i, s in enumerate(snaps) if s.get("mes") == mes and s.get("ano") == ano), None)
    if idx is not None:
        snaps[idx] = snap
    else:
        snaps.append(snap)
    data["snapshots"].sort(key=lambda s: (s.get("ano", 0), s.get("mes", 0)))


def _update_hierarchy_from_discovery(tenant_id: str, discovered: dict):
    with get_tenant_lock(tenant_id, "hierarchy"):
        hier_data = load_json_safe(tenant_path(tenant_id, "hierarchy.json"), {"hierarchy": {}})
        hier = hier_data.get("hierarchy", {})
        updated = False
        for macro, area_map in discovered.items():
            areas_set = set(area_map.keys())
            subareas = {a: sorted(subs) for a, subs in area_map.items() if subs}
            if macro not in hier:
                hier[macro] = {"areas": sorted(areas_set), "subareas": subareas, "manual": False, "source": "ad"}
                updated = True
            else:
                if not hier[macro].get("manual"):
                    if set(hier[macro].get("areas", [])) != areas_set:
                        hier[macro]["areas"] = sorted(areas_set)
                        updated = True
                    if hier[macro].get("subareas", {}) != subareas:
                        hier[macro]["subareas"] = subareas
                        updated = True
                else:
                    existing = set(hier[macro].get("areas", []))
                    if areas_set - existing:
                        hier[macro]["areas"] = sorted(existing | areas_set)
                        updated = True
                    existing_subs = hier[macro].get("subareas", {})
                    for area_name, subs in subareas.items():
                        ex = set(existing_subs.get(area_name, []))
                        if set(subs) - ex:
                            existing_subs[area_name] = sorted(ex | set(subs))
                            updated = True
                    hier[macro]["subareas"] = existing_subs
                if not hier[macro].get("source"):
                    hier[macro]["source"] = "ad"
                    updated = True
        if updated:
            hier_data["hierarchy"] = hier
            save_json_atomic(tenant_path(tenant_id, "hierarchy.json"), hier_data)
            log.info("Hierarquia atualizada com %d setores do AD", len(discovered))


def _fetch_usage_reports(token: str, now_iso: str) -> dict:
    usage = {}
    try:
        rows = graph_get_csv_report(token, "https://graph.microsoft.com/v1.0/reports/getMailboxUsageDetail(period='D30')")
        for row in rows:
            mail = get_csv_field(row, "User Principal Name").lower().strip()
            if not mail:
                continue
            entry = usage.setdefault(mail, {"importedAt": now_iso})
            storage = get_csv_field(row, "Storage Used (Byte)")
            if storage:
                try:
                    entry["mailboxMB"] = round(int(storage) / 1048576, 1)
                except (ValueError, TypeError):
                    pass
            items = get_csv_field(row, "Item Count")
            if items:
                try:
                    entry["mailboxItems"] = int(items)
                except (ValueError, TypeError):
                    pass
            last_act = get_csv_field(row, "Last Activity Date")
            if last_act and last_act.lower() != "never":
                entry["lastActivity"] = last_act
        log.info("Mailbox usage: %d registros", len(rows))
    except Exception as e:
        log.warning("Falha ao obter mailbox usage: %s", e)

    try:
        rows = graph_get_csv_report(token, "https://graph.microsoft.com/v1.0/reports/getOneDriveUsageAccountDetail(period='D30')")
        for row in rows:
            mail = get_csv_field(row, "Owner Principal Name").lower().strip()
            if not mail:
                continue
            entry = usage.setdefault(mail, {"importedAt": now_iso})
            storage = get_csv_field(row, "Storage Used (Byte)")
            if storage:
                try:
                    entry["onedriveMB"] = round(int(storage) / 1048576, 1)
                except (ValueError, TypeError):
                    pass
            files = get_csv_field(row, "File Count")
            if files:
                try:
                    entry["onedriveFiles"] = int(files)
                except (ValueError, TypeError):
                    pass
        log.info("OneDrive usage: %d registros", len(rows))
    except Exception as e:
        log.warning("Falha ao obter OneDrive usage: %s", e)

    try:
        rows = graph_get_csv_report(token, "https://graph.microsoft.com/v1.0/reports/getM365AppUserDetail(period='D30')")
        for row in rows:
            mail = get_csv_field(row, "User Principal Name").lower().strip()
            if not mail:
                continue
            entry = usage.setdefault(mail, {"importedAt": now_iso})
            entry["appsDesktop"] = (
                get_csv_field(row, "Windows").lower() == "yes"
                or get_csv_field(row, "Mac").lower() == "yes"
            )
            entry["appsWeb"] = get_csv_field(row, "Web").lower() == "yes"
            entry["appsMobile"] = get_csv_field(row, "Mobile").lower() == "yes"
            desktop_apps = [
                app for app in ["Outlook", "Word", "Excel", "PowerPoint", "OneNote", "Teams"]
                if (get_csv_field(row, f"{app} (Windows)").lower() == "yes"
                    or get_csv_field(row, f"{app} (Mac)").lower() == "yes")
            ]
            if desktop_apps:
                entry["desktopApps"] = desktop_apps
        log.info("M365 Apps usage: %d registros", len(rows))
    except Exception as e:
        log.warning("Falha ao obter M365 Apps usage: %s", e)

    return usage


# ── Auto sync loop ────────────────────────────────────────────────────────────

def _auto_sync_loop(tenant_id: str = "live"):
    while True:
        cfg = load_graph_config(tenant_id)
        if not cfg.get("auto_sync"):
            time.sleep(60)
            continue
        interval = max(cfg.get("sync_interval_hours", 24), 1) * 3600
        status = _sync_status.get(tenant_id, {})
        last = status.get("lastSync")
        if last:
            try:
                last_dt = datetime.fromisoformat(last.replace("Z", "+00:00"))
                elapsed = (datetime.now(timezone.utc) - last_dt).total_seconds()
                if elapsed < interval:
                    time.sleep(min(interval - elapsed, 300))
                    continue
            except Exception:
                pass
        log.info("Auto-sync iniciado para tenant %s", tenant_id)
        do_graph_sync(cfg, tenant_id)
        time.sleep(300)


def ensure_sync_thread(tenant_id: str = "live"):
    t = _sync_threads.get(tenant_id)
    if t is None or not t.is_alive():
        _sync_threads[tenant_id] = threading.Thread(
            target=_auto_sync_loop, args=(tenant_id,), daemon=True
        )
        _sync_threads[tenant_id].start()
