"""Mede onde a tinta caiu nas folhas que o `provar-impressao.mjs` gravou.

Esta e a metade que importa, e quase ficou de fora.

O defeito relatado foi "esta imprimindo um A5 no meio do A4". A folha nunca
esteve errada — ela sempre saiu A4. O que estava errado era a **arte**,
encolhida por 210/297 (0,707) e centralizada, porque o CSS declarava a folha
em retrato enquanto o driver recebia uma folha deitada.

Medir so o tamanho da pagina, como a primeira versao do script fazia, teria
aprovado o defeito sem piscar. O que denuncia e a area coberta: a pagina de
teste e um retangulo preto que deve cobrir a folha inteira. Cobrindo metade,
com branco em volta, e o defeito de volta.

    motor/runtime/python.exe scripts/provar-impressao.py
"""

from __future__ import annotations

import os
import sys

import pymupdf

PASTA = os.path.join("dist-app", ".prova-impressao")

# A arte cobre a folha toda; abaixo disso houve encolhimento.
COBERTURA_MINIMA = 0.97


def medir(caminho: str) -> tuple[float, tuple[float, float, float, float]]:
    """Devolve a fracao coberta por tinta e a margem branca de cada lado."""
    doc = pymupdf.open(caminho)
    try:
        pagina = doc[0]
        mapa = pagina.get_pixmap(dpi=72, colorspace=pymupdf.csGRAY)

        escuros = 0
        esquerda, direita = mapa.width, 0
        cima, baixo = mapa.height, 0

        for y in range(mapa.height):
            inicio = y * mapa.stride
            linha = mapa.samples[inicio : inicio + mapa.width]
            for x, valor in enumerate(linha):
                if valor >= 128:
                    continue
                escuros += 1
                esquerda = min(esquerda, x)
                direita = max(direita, x)
                cima = min(cima, y)
                baixo = max(baixo, y)

        total = mapa.width * mapa.height
        if not escuros:
            return 0.0, (0, 0, 0, 0)

        margens = (
            esquerda / mapa.width,
            (mapa.width - 1 - direita) / mapa.width,
            cima / mapa.height,
            (mapa.height - 1 - baixo) / mapa.height,
        )
        return escuros / total, margens
    finally:
        doc.close()


def principal() -> int:
    if not os.path.isdir(PASTA):
        print(f"nao achei {PASTA}. Rode antes: npx electron scripts/provar-impressao.mjs")
        return 2

    falhou = False
    for nome, rotulo in [("em-pe.pdf", "A4 em pe"), ("deitada.pdf", "A4 deitada")]:
        caminho = os.path.join(PASTA, nome)
        if not os.path.exists(caminho):
            print(f"  {rotulo:<12} FALTOU o arquivo {nome}")
            falhou = True
            continue

        cobertura, margens = medir(caminho)
        ok = cobertura >= COBERTURA_MINIMA
        print(f"  {rotulo:<12} tinta cobre {cobertura * 100:5.1f}% da folha   {'OK' if ok else 'ERRADO'}")

        if not ok:
            falhou = True
            maior = max(margens)
            print(f"     sobrou branco: ate {maior * 100:.1f}% de um lado")
            # 0,707 de lado da 0,5 de area, e a margem branca fica em ~14,6%.
            if 0.45 <= cobertura <= 0.55:
                print("     ^ metade da area e a assinatura do defeito antigo (encolhimento de 0,707).")

    print("\nREPROVOU" if falhou else "\nA arte cobre a folha inteira nas duas orientacoes.")
    return 1 if falhou else 0


if __name__ == "__main__":
    sys.exit(principal())
