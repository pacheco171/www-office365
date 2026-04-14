"""Blueprint: /api/ai/* — chat e teste da IA."""

import json
from datetime import datetime

from flask import Blueprint, request, jsonify, Response

from app.auth_service import require_role
from app.config import http_requests
from app.utils import log, load_data
from app.graph_service import load_graph_config

bp = Blueprint("ai", __name__)

_AI_SYSTEM_PROMPT = """Você é o assistente de IA do painel LIVE! Microsoft 365. Você analisa dados reais de licenças, custos e uso do Microsoft 365 da empresa LIVE (liveoficial.com.br).

Suas capacidades:
- Responder sobre custos atuais, por setor, por licença
- Identificar desperdício e sugerir otimizações concretas
- Comparar meses/tendências históricas
- Explicar os tipos de licença M365 e suas diferenças
- Sugerir ações concretas de redução de custo com impacto financeiro

Regras:
- Responda SEMPRE em português brasileiro
- Use os dados fornecidos como base factual — não invente números
- Formate valores monetários como R$ 1.234,56
- Seja conciso mas completo, use bullet points quando apropriado
- Quando sugerir mudanças, cite o impacto financeiro estimado
- Se não tiver dados suficientes para responder, diga claramente
- Use negrito (**texto**) para destacar valores importantes

Preços das licenças (R$/mês por usuário):
- M365 Business Standard: R$78,15
- M365 Business Basic: R$31,21
- M365 Apps for Business: R$51,54 (add-on, sem Exchange/Teams)
- Office 365 F3: R$25,00 (frontline, básico)
- Office 365 E3: R$90,29 (enterprise, completo)
- Power BI Pro: R$87,55 (add-on)"""


def _build_ai_data_summary(tenant_id: str = "live") -> str:
    data = load_data(tenant_id)
    db = data.get("db", [])
    if not db:
        return "Nenhum dado disponível. O sistema ainda não foi sincronizado."

    total = len(db)
    ativos = 0
    tipos = {}
    lic_stats = {}
    total_custo = 0
    setor_stats = {}
    inativos_com_licenca_count = 0
    custo_inativos = 0

    for r in db:
        custo = r.get("custo", 0) or 0
        status = r.get("status")
        lid = r.get("licId", "none")
        is_ativo = status == "Ativo"

        if is_ativo:
            ativos += 1
        t = r.get("tipo", "Pessoa")
        tipos[t] = tipos.get(t, 0) + 1

        if lid not in lic_stats:
            lic_stats[lid] = {"count": 0, "custo": 0}
        lic_stats[lid]["count"] += 1
        lic_stats[lid]["custo"] += custo
        total_custo += custo

        s = r.get("setor") or "Sem Setor"
        if s not in setor_stats:
            setor_stats[s] = {"count": 0, "custo": 0, "ativos": 0}
        setor_stats[s]["count"] += 1
        setor_stats[s]["custo"] += custo
        if is_ativo:
            setor_stats[s]["ativos"] += 1

        if not is_ativo and lid not in ("none", "other", None):
            inativos_com_licenca_count += 1
            custo_inativos += custo

    inativos = total - ativos
    lic_names = {
        "bstd": "Business Standard", "bbasic": "Business Basic",
        "apps": "Apps for Business", "f3": "Office 365 F3",
        "e3": "Office 365 E3", "pbi": "Power BI Pro",
        "none": "Sem licença", "other": "Outra"
    }
    top_setores = sorted(setor_stats.items(), key=lambda x: -x[1]["custo"])[:10]

    usage = data.get("usage", {})
    uso_info = ""
    if usage:
        com_mailbox = sum(1 for u in usage.values() if u.get("mailboxMB"))
        com_onedrive = sum(1 for u in usage.values() if u.get("onedriveMB"))
        baixo_mail = sum(1 for u in usage.values() if u.get("mailboxMB") and u["mailboxMB"] < 100)
        baixo_drive = sum(1 for u in usage.values() if u.get("onedriveMB") and u["onedriveMB"] < 100)
        uso_info = f"\nUSO:\n- {com_mailbox} com dados de mailbox ({baixo_mail} com menos de 100MB)"
        uso_info += f"\n- {com_onedrive} com dados de OneDrive ({baixo_drive} com menos de 100MB)"

    snaps = data.get("snapshots", [])
    tendencia = ""
    if len(snaps) >= 2:
        last, prev = snaps[-1], snaps[-2]
        custo_last = sum(r.get("custo", 0) or 0 for r in last.get("data", []))
        custo_prev = sum(r.get("custo", 0) or 0 for r in prev.get("data", []))
        delta = custo_last - custo_prev
        sinal = "+" if delta >= 0 else ""
        tendencia = f"\nTENDÊNCIA:\n- {prev.get('label','?')} → {last.get('label','?')}: R$ {custo_prev:,.2f} → R$ {custo_last:,.2f} ({sinal}R$ {delta:,.2f})"

    lines = [f"=== RESUMO M365 — {datetime.now().strftime('%d/%m/%Y')} ==="]
    lines.append(f"Total: {total} contas ({', '.join(f'{v} {k}' for k, v in sorted(tipos.items()))})")
    lines.append(f"Ativos: {ativos} | Inativos: {inativos}")
    lines.append("\nCUSTO MENSAL POR LICENÇA:")
    for lid in ["e3", "bstd", "bbasic", "apps", "f3", "pbi", "none", "other"]:
        st = lic_stats.get(lid)
        if st and st["count"] > 0:
            lines.append(f"- {lic_names.get(lid, lid)}: {st['count']} usuários, R$ {st['custo']:,.2f}/mês")
    lines.append(f"TOTAL MENSAL: R$ {total_custo:,.2f} | ANUAL: R$ {total_custo * 12:,.2f}")
    lines.append("\nTOP SETORES POR CUSTO:")
    for s, st in top_setores:
        lines.append(f"- {s}: {st['count']} pessoas ({st['ativos']} ativos), R$ {st['custo']:,.2f}/mês")
    if inativos_com_licenca_count:
        lines.append(f"\nOPORTUNIDADES:")
        lines.append(f"- {inativos_com_licenca_count} inativos com licença paga: economia potencial R$ {custo_inativos:,.2f}/mês")
    if uso_info:
        lines.append(uso_info)
    if tendencia:
        lines.append(tendencia)
    return "\n".join(lines)


@bp.route("/api/ai/chat", methods=["POST"])
def ai_chat():
    if not http_requests:
        return jsonify({"error": "Módulo requests não instalado"}), 500

    tid = getattr(request, "tenant_id", "live")
    cfg = load_graph_config(tid)
    api_key = cfg.get("ai_api_key", "")
    if not api_key:
        return jsonify({"error": "API key da IA não configurada. Acesse Config para configurar."}), 400

    body = request.get_json(silent=True) or {}
    messages = body.get("messages", [])
    if not messages or not isinstance(messages, list):
        return jsonify({"error": "Nenhuma mensagem enviada"}), 400

    valid_roles = {"user", "assistant"}
    sanitized = [
        {"role": msg["role"], "content": msg["content"]}
        for msg in messages[-20:]
        if isinstance(msg, dict) and msg.get("role") in valid_roles
        and isinstance(msg.get("content"), str) and len(msg["content"]) <= 10000
    ]
    if not sanitized:
        return jsonify({"error": "Nenhuma mensagem válida"}), 400

    system_prompt = _AI_SYSTEM_PROMPT + "\n\n" + _build_ai_data_summary(tid)

    def generate():
        resp = None
        try:
            resp = http_requests.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": "claude-sonnet-4-20250514",
                    "max_tokens": 1024,
                    "system": system_prompt,
                    "messages": sanitized,
                    "stream": True,
                },
                stream=True,
                timeout=60,
            )
            if resp.status_code != 200:
                yield f"data: {json.dumps({'error': f'API error {resp.status_code}: {resp.text[:200]}'})}\n\n"
                return
            for line in resp.iter_lines():
                if not line:
                    continue
                line = line.decode("utf-8", errors="replace")
                if line.startswith("data: "):
                    payload = line[6:]
                    if payload.strip() == "[DONE]":
                        break
                    try:
                        evt = json.loads(payload)
                        if evt.get("type") == "content_block_delta":
                            text = evt.get("delta", {}).get("text", "")
                            if text:
                                yield f"data: {json.dumps({'text': text})}\n\n"
                    except json.JSONDecodeError:
                        log.warning("AI chat: malformed SSE chunk: %s", payload[:200])
            yield "data: [DONE]\n\n"
        except Exception:
            log.exception("Erro no AI chat")
            yield f"data: {json.dumps({'error': 'Erro interno ao processar chat.'})}\n\n"
        finally:
            if resp is not None:
                resp.close()

    return Response(generate(), content_type="text/event-stream")


@bp.route("/api/ai/test", methods=["POST"])
def ai_test():
    check = require_role("superadmin")
    if check:
        return check
    if not http_requests:
        return jsonify({"error": "Módulo requests não instalado"}), 500

    body = request.get_json(silent=True) or {}
    tid = getattr(request, "tenant_id", "live")
    cfg = load_graph_config(tid)
    api_key = body.get("ai_api_key") or cfg.get("ai_api_key", "")
    if not api_key:
        return jsonify({"ok": False, "error": "Nenhuma API key configurada"}), 400

    try:
        resp = http_requests.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={"model": "claude-sonnet-4-20250514", "max_tokens": 10,
                  "messages": [{"role": "user", "content": "oi"}]},
            timeout=15,
        )
        if resp.status_code == 200:
            return jsonify({"ok": True, "model": "claude-sonnet-4-20250514"})
        return jsonify({"ok": False, "error": f"HTTP {resp.status_code}: resposta inesperada da API"})
    except Exception:
        log.exception("Erro no AI test")
        return jsonify({"ok": False, "error": "Erro ao conectar com a API. Verifique os logs."})
