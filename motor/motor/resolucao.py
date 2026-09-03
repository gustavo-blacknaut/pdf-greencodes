"""Quanta resolução o desenho pode usar sem derrubar a máquina.

Impressora de 600 e de 1200 DPI existem, e o aplicativo passou a oferecer os
dois. Só que DPI de impressora e DPI de imagem não são a mesma coisa: os 1200
de uma laser são endereçamento de retícula — de quantos pontinhos ela dispõe
para simular meio-tom —, não a resolução que o arquivo precisa ter. Foto a
300 DPI numa impressora de 1200 sai perfeita; a 1200 sai igual, só que com o
arquivo dezesseis vezes maior.

Onde 600 e 1200 ganham de verdade é em traço e texto fininho, que não têm
meio-tom para simular e onde a borda do desenho aparece.

A trava existe porque uma A4 a 1200 DPI tem 139 milhões de pixels: 418 MB em
RGB, 558 MB em CMYK — de uma página só. Numa máquina de 4 GB isso derruba o
motor sem explicar nada. Aqui a resolução cai até caber e o resultado diz que
caiu, em vez de morrer no meio.
"""

from __future__ import annotations

from typing import Tuple

DPI_MINIMO = 36
DPI_MAXIMO = 1200

# Teto de memória para o mapa de pixels de uma página.
#
# O pico real é o dobro disto: a conversão de cor segura o mapa de origem e o
# de destino ao mesmo tempo. Com 500 MB de teto, o pico bate em 1 GB, e ainda
# sobra espaço numa máquina de 4 GB com o Chromium do aplicativo do outro
# lado. Uma A4 a 1200 DPI em CMYK dá 531 MB e cai aqui — de propósito.
TETO_DE_MEMORIA = 500 * 1024 * 1024

PONTOS_POR_POLEGADA = 72


def na_faixa(dpi: object, padrao: int = 150) -> int:
    """O que veio da tela, dentro dos limites que o motor aceita."""
    try:
        valor = int(dpi)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return padrao
    return max(DPI_MINIMO, min(DPI_MAXIMO, valor))


def bytes_da_pagina(largura_pt: float, altura_pt: float, dpi: int, canais: int) -> int:
    """Quanto ocupa o mapa de pixels dessa página nessa resolução."""
    largura = largura_pt / PONTOS_POR_POLEGADA * dpi
    altura = altura_pt / PONTOS_POR_POLEGADA * dpi
    return int(largura * altura * canais)


def couber(largura_pt: float, altura_pt: float, dpi: int, canais: int = 3) -> Tuple[int, bool]:
    """A maior resolução que cabe na memória, e se precisou baixar.

    A conta é direta: o tamanho cresce com o quadrado do DPI, então o fator de
    redução é a raiz da razão entre o que cabe e o que foi pedido.
    """
    pedido = bytes_da_pagina(largura_pt, altura_pt, dpi, canais)
    if pedido <= TETO_DE_MEMORIA:
        return dpi, False

    fator = (TETO_DE_MEMORIA / pedido) ** 0.5
    return max(DPI_MINIMO, int(dpi * fator)), True


def aviso_de_reducao(pedido: int, usado: int) -> str:
    return (
        f"A resolução caiu de {pedido} para {usado} DPI: nesse tamanho de página, "
        f"{pedido} DPI ocuparia mais memória do que dá para segurar de uma vez. "
        "Para traço fino, dividir o documento em partes menores resolve."
    )
