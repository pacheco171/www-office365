"""Catálogo de licenças M365, mapeamentos de SKU e cálculo de custo."""

# Mapeamento de SKU IDs do M365 para nossos licId
# Fonte: https://learn.microsoft.com/en-us/entra/identity/users/licensing-service-plan-reference
SKU_MAP = {
    # Business
    "O365_BUSINESS_ESSENTIALS": "bbasic",
    "SMB_BUSINESS_ESSENTIALS": "bbasic",
    "O365_BUSINESS_PREMIUM": "bstd",
    "SMB_BUSINESS_PREMIUM": "bstd",
    "SPB": "bstd",
    "O365_BUSINESS": "apps",
    "SMB_BUSINESS": "apps",
    # Frontline
    "DESKLESSPACK": "f3",
    # Enterprise
    "ENTERPRISEPACK": "e3",
    "ENTERPRISEPACK_NOTEAMS": "e3",
    "OFFICE_365_E3_(NO_TEAMS)": "e3",
    # Add-ons pagos
    "POWER_BI_PRO": "pbi",
    "PBI_PREMIUM_PER_USER": "pbi",
    # Licenças gratuitas — ignorar
    "POWER_BI_STANDARD": "_free",
    "POWER_AUTOMATE_FREE": "_free",
    "FLOW_FREE": "_free",
    "MICROSOFT_FABRIC_FREE": "_free",
    "MICROSOFT_TEAMS_ENTERPRISE_NEW": "_free",
    "AAD_PREMIUM": "_free",
    "EXCHANGEARCHIVE_ADDON": "_free",
    "PROJECTPROFESSIONAL": "planner3",
    "PROJECT_P1": "planner1",
    "POWERAPPS_DEV": "_free",
    "CCIBOTS_PRIVPREV_VIRAL": "_free",
    "MICROSOFT_365_COPILOT": "_free",
    "POWER_PAGES_VTRIAL_FOR_MAKERS": "_free",
    "WACONEDRIVEENTERPRISE": "_free",
}

# Mapeamento alternativo por substrings do nome da licença (fallback)
LIC_NAME_MAP = [
    ("business standard", "bstd"),
    ("business basic", "bbasic"),
    ("business essentials", "bbasic"),
    ("apps for business", "apps"),
    ("office 365 f3", "f3"),
    ("office 365 e3", "e3"),
    ("enterprise e3", "e3"),
    ("power bi pro", "pbi"),
    ("power bi premium", "pbi"),
    ("power bi (free)", "_free"),
    ("power automate free", "_free"),
    ("fabric (free)", "_free"),
    ("planner plan 1", "planner1"),
    ("planner and project plan 3", "planner3"),
    ("project professional", "planner3"),
]

# Prioridade para resolver licença principal quando múltiplas estão presentes
LIC_PRIORITY = ["e3", "bstd", "bbasic", "f3", "apps", "pbi", "planner3", "planner1", "other", "none"]

# Preços mensais por usuário (R$)
LIC_PRICES = {
    "none": 0, "bstd": 78.15, "bbasic": 31.21, "apps": 51.54,
    "f3": 25, "e3": 90.29, "pbi": 87.55, "planner1": 62.54,
    "planner3": 187.55, "other": 0,
}

# Catálogo completo para retornar ao frontend
LIC_CATALOG = [
    {"id": "none", "name": "Outros", "short": "Outros", "price": 0, "addon": False, "tier": "—", "cls": "lic-none", "ico": "○", "color": "#8a8070", "csvNames": ["unlicensed"], "features": ["Sem acesso ao Microsoft 365"]},
    {"id": "bstd", "name": "M365 Business Standard", "short": "Business Standard", "price": 78.15, "addon": False, "tier": "Business", "cls": "lic-bstd", "ico": "◉", "color": "#7a5c30", "csvNames": ["microsoft 365 business standard"], "features": ["Apps desktop completos", "Teams + Webinars", "Exchange 50 GB", "OneDrive 1 TB", "SharePoint"]},
    {"id": "bbasic", "name": "M365 Business Basic", "short": "Business Basic", "price": 31.21, "addon": False, "tier": "Business", "cls": "lic-bbasic", "ico": "◎", "color": "#9c7a52", "csvNames": ["microsoft 365 business basic"], "features": ["Apps Office web e mobile", "Teams completo", "Exchange 50 GB", "OneDrive 1 TB", "SharePoint"]},
    {"id": "apps", "name": "M365 Apps for Business", "short": "Apps Business", "price": 51.54, "addon": True, "tier": "Add-on", "cls": "lic-apps", "ico": "◍", "color": "#c97a20", "csvNames": ["microsoft 365 apps for business"], "features": ["Word/Excel/PowerPoint desktop", "OneDrive 1 TB", "Sem Exchange", "Sem Teams"]},
    {"id": "f3", "name": "Office 365 F3", "short": "O365 F3", "price": 25, "addon": False, "tier": "Frontline", "cls": "lic-f3", "ico": "◌", "color": "#0078d4", "csvNames": ["office 365 f3"], "features": ["Apps web e mobile", "Teams Essentials", "Exchange 2 GB", "OneDrive 2 GB"]},
    {"id": "e3", "name": "Office 365 E3", "short": "O365 E3", "price": 90.29, "addon": False, "tier": "Enterprise", "cls": "lic-e3", "ico": "⬡", "color": "#3a7050", "csvNames": ["office 365 e3", "office 365 e3 (no teams)"], "features": ["Apps desktop ilimitados", "Teams Enterprise", "Exchange ilimitado", "Compliance e auditoria"]},
    {"id": "pbi", "name": "Power BI Pro", "short": "PBI Pro", "price": 87.55, "addon": True, "tier": "Add-on", "cls": "lic-pbi", "ico": "◈", "color": "#b8903a", "csvNames": ["power bi pro", "power bi premium per user", "m 365 power bi pro"], "features": ["Dashboards compartilhados", "Relatórios avançados", "API e embed"]},
    {"id": "planner1", "name": "Planner Plan 1", "short": "Planner 1", "price": 62.54, "addon": True, "tier": "Add-on", "cls": "lic-planner1", "ico": "▣", "color": "#217346", "csvNames": ["planner plan 1"], "features": ["Planner Premium", "Gestão de tarefas avançada", "Visualizações de cronograma"]},
    {"id": "planner3", "name": "Planner and Project Plan 3", "short": "Planner+Project 3", "price": 187.55, "addon": True, "tier": "Add-on", "cls": "lic-planner3", "ico": "▩", "color": "#1a5c30", "csvNames": ["planner and project plan 3", "project professional"], "features": ["Planner Premium", "Project Online", "Gestão de projetos completa", "Relatórios de portfólio"]},
    {"id": "other", "name": "Outra Licença", "short": "Outro", "price": 0, "addon": False, "tier": "Outro", "cls": "lic-none", "ico": "○", "color": "#8a8070", "csvNames": [], "features": ["Licença não mapeada"]},
]


def compute_cost(lic_id: str, addons: list) -> float:
    """Calcula custo mensal de um usuário (licença principal + add-ons pagos)."""
    cost = LIC_PRICES.get(lic_id, 0)
    for a in (addons or []):
        cost += LIC_PRICES.get(a, 0)
    return round(cost, 2)
