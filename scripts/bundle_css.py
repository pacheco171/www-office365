"""
bundle_css.py — Concatena os arquivos CSS fonte em bundles otimizados.

Uso:
  python scripts/bundle_css.py

Saída:
  src/css/bundle-core.css  — CSS global (carregado em todas as páginas)
  src/css/bundle-views.css — CSS view-específico (todas as views)

Execute após editar qualquer arquivo CSS fonte.
"""

import os

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSS = os.path.join(BASE, "src", "css")

CORE_FILES = [
    "variables.css",
    "base.css",
    "sidebar.css",
    "layout.css",
    "metrics.css",
    "charts.css",
    "components.css",
    "table.css",
    "modal.css",
    "toolbar.css",
    "ai-chat.css",
]

VIEWS_FILES = [
    "views/licencas.css",
    "views/optimization.css",
    "views/config.css",
    "views/radar.css",
    "views/contracts.css",
    "views/suggestions.css",
    "views/report.css",
    "views/auditoria.css",
    "views/acoes.css",
    "views/simulador.css",
    "views/forecast.css",
    "views/exchange.css",
    "views/onedrive.css",
    "views/dominios.css",
    "views/grupos.css",
    "views/aplicativos.css",
    "views/privilegios.css",
    "views/politicas.css",
    "views/alertas.css",
    "views/assessment.css",
    "views/suporte.css",
]


def build_bundle(output_name, files):
    parts = [f"/* bundle: {output_name} — gerado por scripts/bundle_css.py */\n"]
    for rel in files:
        path = os.path.join(CSS, rel)
        if not os.path.exists(path):
            print(f"  AVISO: {rel} não encontrado, pulando.")
            continue
        with open(path, "r", encoding="utf-8") as f:
            content = f.read().strip()
        parts.append(f"\n/* ── {rel} ── */\n{content}\n")

    out_path = os.path.join(CSS, output_name)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("\n".join(parts))

    size_kb = os.path.getsize(out_path) / 1024
    print(f"  {output_name}: {len(files)} arquivos -> {size_kb:.1f} KB")


if __name__ == "__main__":
    print("Gerando bundles CSS...")
    build_bundle("bundle-core.css", CORE_FILES)
    build_bundle("bundle-views.css", VIEWS_FILES)
    print("Pronto.")
