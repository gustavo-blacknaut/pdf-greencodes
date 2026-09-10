"""Mede onde a tinta caiu nas folhas que o `provar-impressao.mjs` gravou.

Esta e a metade que importa, e quase ficou de fora.

O defeito relatado foi "esta imprimindo um A5 no meio do A4". A folha nunca
esteve errada — ela sempre saiu A4. O que estava errado era a **arte**,
encolhida por 210/297 (0,707) e centralizada, porque o CSS declarava a folha
em retrato enquanto o driver recebia uma folha deitada.

Medir so o tamanho da pagina, como a primeira versao do script fazia, teria
aprovado o defeito sem piscar. O que denuncia e a area coberta: a pagina de
teste e um retangulo preto, e sabendo a escala pedida da para dizer quanto
dela deve estar coberto.

    npm run provar-impressao
"""

from __future__ import annotations

import json
import os
import sys

import pymupdf

PASTA = os.path.join("dist-app", ".prova-impressao")


def medir(caminho: str) -> float:
    """A fracao da folha coberta por tinta."""
    doc = pymupdf.open(caminho)
    try:
        mapa = doc[0].get_pixmap(dpi=72, colorspace=pymupdf.csGRAY)
        escuros = 0
        for y in range(mapa.height):
            inicio = y * mapa.stride
            linha = mapa.samples[inicio : inicio + mapa.width]
            escuros += sum(1 for valor in linha if valor < 128)
        return escuros / (mapa.width * mapa.height)
    finally:
        doc.close()


def principal() -> int:
    lista = os.path.join(PASTA, "casos.json")
    if not os.path.exists(lista):
        print(f"nao achei {lista}. Rode antes: npm run provar-impressao")
        return 2

    with open(lista, encoding="utf-8") as arquivo:
        casos = json.load(arquivo)

    falhou = False
    for caso in casos:
        caminho = os.path.join(PASTA, caso["arquivo"])
        if not os.path.exists(caminho):
            print(f"  {caso['nome']:<14} FALTOU o arquivo")
            falhou = True
            continue

        cobertura = medir(caminho)
        minimo, maximo = caso["cobertura"]
        ok = minimo <= cobertura <= maximo

        print(
            f"  {caso['nome']:<14} tinta cobre {cobertura * 100:5.1f}% "
            f"(esperado entre {minimo * 100:.0f}% e {maximo * 100:.0f}%)   {'OK' if ok else 'ERRADO'}"
        )

        if not ok:
            falhou = True
            # Metade da area e a assinatura do defeito da folha deitada.
            if 0.45 <= cobertura <= 0.55 and minimo > 0.9:
                print("     ^ metade da area: o encolhimento de 0,707 voltou.")

    print("\nREPROVOU" if falhou else "\nA arte cai onde deveria, nas quatro montagens.")
    return 1 if falhou else 0


if __name__ == "__main__":
    sys.exit(principal())
