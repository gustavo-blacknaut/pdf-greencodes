"""O que o aplicativo precisa saber antes de oferecer qualquer coisa."""

from __future__ import annotations

import os
from typing import Any, Dict

import pymupdf

from ..documento import abrir
from ..protocolo import Pedido

# Um ponto PostScript e 1/72 de polegada; a conta leva para milimetros, que e
# como o papel e vendido e como o usuario pensa.
MM_POR_PONTO = 25.4 / 72

# Formatos comuns em milimetros, com folga de 2 mm porque gerador de PDF
# arredonda de um jeito que raramente bate exato.
FORMATOS = {
    "A3": (297, 420),
    "A4": (210, 297),
    "A5": (148, 210),
    "Carta": (216, 279),
    "Oficio": (216, 356),
    "10x15": (100, 150),
}


def formato_do_papel(largura_mm: float, altura_mm: float) -> str:
    """O nome do papel, ou a medida quando nao e um formato conhecido."""
    curto, longo = sorted((largura_mm, altura_mm))
    for nome, (a, b) in FORMATOS.items():
        if abs(curto - a) <= 2 and abs(longo - b) <= 2:
            return nome
    return f"{round(largura_mm)}x{round(altura_mm)} mm"


def informar(pedido: Pedido) -> Dict[str, Any]:
    """Paginas, tamanho, orientacao e se tem senha, de cada arquivo."""
    arquivos = []

    for indice, caminho in enumerate(pedido.arquivos):
        bytes_em_disco = os.path.getsize(caminho) if os.path.exists(caminho) else 0

        # Uma passada so para descobrir se pede senha, sem abrir de fato. Assim
        # o aplicativo consegue pedir a senha antes de tentar qualquer coisa.
        protegido = False
        try:
            espiada = pymupdf.open(caminho)
            protegido = espiada.needs_pass
            espiada.close()
        except Exception:  # noqa: BLE001 - arquivo ilegivel vira erro abaixo
            pass

        if protegido and not pedido.senha(indice):
            arquivos.append(
                {
                    "caminho": caminho,
                    "nome": os.path.basename(caminho),
                    "bytes": bytes_em_disco,
                    "protegido": True,
                    "precisaSenha": True,
                }
            )
            continue

        doc = abrir(caminho, pedido.senha(indice))
        try:
            paginas = []
            for pagina in doc:
                caixa = pagina.rect
                largura_mm = caixa.width * MM_POR_PONTO
                altura_mm = caixa.height * MM_POR_PONTO
                paginas.append(
                    {
                        "numero": pagina.number + 1,
                        "larguraMm": round(largura_mm, 1),
                        "alturaMm": round(altura_mm, 1),
                        "formato": formato_do_papel(largura_mm, altura_mm),
                        "deitada": largura_mm > altura_mm,
                        "giro": pagina.rotation,
                    }
                )

            metadados = doc.metadata or {}
            arquivos.append(
                {
                    "caminho": caminho,
                    "nome": os.path.basename(caminho),
                    "bytes": bytes_em_disco,
                    "protegido": protegido,
                    "precisaSenha": False,
                    "paginas": len(paginas),
                    "temTexto": any(doc[i].get_text().strip() for i in range(min(3, len(doc)))),
                    "titulo": metadados.get("title") or "",
                    "autor": metadados.get("author") or "",
                    "detalhePaginas": paginas,
                }
            )
        finally:
            doc.close()

    return {"arquivos": arquivos}
