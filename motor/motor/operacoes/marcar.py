"""Escrever por cima: número de página, marca d'água, cabeçalho e rodapé.

As três desenham texto novo sobre a página, sem tocar no que já estava lá. O
documento continua pesquisável e a operação é reversível na prática — basta
não salvar por cima do original.
"""

from __future__ import annotations

from typing import Any, Dict, Tuple

import pymupdf

from ..documento import abrir, faixa_de_paginas, nome_com_sufixo, salvar
from ..protocolo import ErroDoUsuario, Pedido

PONTOS_POR_MM = 72 / 25.4

# Fontes que o MuPDF traz embutidas, sem precisar de arquivo de fonte junto.
FONTES = {
    "helv": "Helvetica",
    "tiro": "Times",
    "cour": "Courier",
}

POSICOES = {
    "rodape-centro": ("baixo", "centro"),
    "rodape-direita": ("baixo", "direita"),
    "rodape-esquerda": ("baixo", "esquerda"),
    "topo-centro": ("cima", "centro"),
    "topo-direita": ("cima", "direita"),
    "topo-esquerda": ("cima", "esquerda"),
}


def _ponto(caixa: pymupdf.Rect, vertical: str, horizontal: str, margem: float, tamanho: float, largura_texto: float) -> pymupdf.Point:
    y = caixa.y1 - margem if vertical == "baixo" else caixa.y0 + margem + tamanho

    if horizontal == "esquerda":
        x = caixa.x0 + margem
    elif horizontal == "direita":
        x = caixa.x1 - margem - largura_texto
    else:
        x = (caixa.width - largura_texto) / 2

    return pymupdf.Point(x, y)


def _texto_do_numero(modelo: str, numero: int, total: int) -> str:
    """Troca {n} pelo número e {total} pelo total."""
    return modelo.replace("{n}", str(numero)).replace("{total}", str(total))


def numerar(pedido: Pedido) -> Dict[str, Any]:
    """Escreve o número em cada página.

    O primeiro número é configurável porque capa e folha de rosto quase nunca
    entram na contagem, e refazer isso à mão é o tipo de coisa que faz alguém
    imprimir duas vezes.
    """
    if not pedido.arquivos:
        raise ErroDoUsuario("nenhum arquivo escolhido")

    modelo = str(pedido.opcao("formato", "{n}"))
    comeco = int(pedido.opcao("comecarEm", 1))
    tamanho = float(pedido.opcao("tamanho", 10))
    margem = float(pedido.opcao("margem", 12)) * PONTOS_POR_MM
    fonte = str(pedido.opcao("fonte", "helv"))
    vertical, horizontal = POSICOES.get(str(pedido.opcao("posicao", "rodape-centro")), ("baixo", "centro"))

    origem = pedido.arquivos[0]
    senha = pedido.senha(0)
    doc = abrir(origem, senha)
    try:
        escolhidas = faixa_de_paginas(str(pedido.opcao("paginas", "")), doc.page_count)
        total = len(escolhidas)

        for posicao, indice in enumerate(escolhidas):
            pedido.andamento(posicao / total, f"Página {posicao + 1} de {total}")
            pagina = doc[indice]

            texto = _texto_do_numero(modelo, comeco + posicao, comeco + total - 1)
            largura = pymupdf.get_text_length(texto, fontname=fonte, fontsize=tamanho)
            pagina.insert_text(
                _ponto(pagina.rect, vertical, horizontal, margem, tamanho, largura),
                texto,
                fontname=fonte,
                fontsize=tamanho,
                color=(0, 0, 0),
            )

        destino = pedido.saida or nome_com_sufixo(origem, "numerado")
        bytes_saida = salvar(doc, destino, senha)

        pedido.andamento(1.0)
        return {"arquivo": destino, "paginas": total, "bytes": bytes_saida}
    finally:
        doc.close()


def marca_dagua(pedido: Pedido) -> Dict[str, Any]:
    """Escreve na diagonal, por cima de tudo.

    Fica clara e grande de propósito: marca d'água serve para dizer "não é o
    documento final", e para isso precisa ser vista sem atrapalhar a leitura.
    """
    if not pedido.arquivos:
        raise ErroDoUsuario("nenhum arquivo escolhido")

    texto = str(pedido.opcao("texto", "RASCUNHO")).strip()
    if not texto:
        raise ErroDoUsuario("escreva o que a marca d'água deve dizer")

    tamanho = float(pedido.opcao("tamanho", 48))
    opacidade = max(0.05, min(1.0, float(pedido.opcao("opacidade", 0.18))))
    graus = float(pedido.opcao("giro", 45))
    cor = _cor(str(pedido.opcao("cor", "cinza")))
    fonte = str(pedido.opcao("fonte", "helv"))

    origem = pedido.arquivos[0]
    senha = pedido.senha(0)
    doc = abrir(origem, senha)
    try:
        escolhidas = faixa_de_paginas(str(pedido.opcao("paginas", "")), doc.page_count)
        total = len(escolhidas)

        largura_texto = pymupdf.get_text_length(texto, fontname=fonte, fontsize=tamanho)

        for posicao, indice in enumerate(escolhidas):
            pedido.andamento(posicao / total, f"Página {posicao + 1} de {total}")
            pagina = doc[indice]

            # insert_textbox com morph corta as primeiras letras quando o
            # texto gira: a caixa recorta antes da rotação. insert_text não
            # tem esse problema, então o centro é calculado à mão.
            centro = pymupdf.Point(pagina.rect.width / 2, pagina.rect.height / 2)
            origem = pymupdf.Point(centro.x - largura_texto / 2, centro.y + tamanho * 0.3)

            pagina.insert_text(
                origem,
                texto,
                fontname=fonte,
                fontsize=tamanho,
                color=cor,
                fill_opacity=opacidade,
                stroke_opacity=opacidade,
                morph=(centro, pymupdf.Matrix(graus)),
                overlay=True,
            )

        destino = pedido.saida or nome_com_sufixo(origem, "marca-dagua")
        bytes_saida = salvar(doc, destino, senha)

        pedido.andamento(1.0)
        return {
            "arquivo": destino,
            "paginas": total,
            "bytes": bytes_saida,
            "notas": ["A marca é texto por cima, não faz parte da página. Quem abrir o PDF consegue removê-la."],
        }
    finally:
        doc.close()


def cabecalho_rodape(pedido: Pedido) -> Dict[str, Any]:
    """Uma linha no topo e outra no pé, iguais em todas as páginas."""
    if not pedido.arquivos:
        raise ErroDoUsuario("nenhum arquivo escolhido")

    cabecalho = str(pedido.opcao("cabecalho", "")).strip()
    rodape = str(pedido.opcao("rodape", "")).strip()
    if not cabecalho and not rodape:
        raise ErroDoUsuario("escreva pelo menos o cabeçalho ou o rodapé")

    tamanho = float(pedido.opcao("tamanho", 9))
    margem = float(pedido.opcao("margem", 10)) * PONTOS_POR_MM
    fonte = str(pedido.opcao("fonte", "helv"))
    alinhamento = str(pedido.opcao("alinhamento", "centro"))

    origem = pedido.arquivos[0]
    senha = pedido.senha(0)
    doc = abrir(origem, senha)
    try:
        total = doc.page_count
        for indice in range(total):
            pedido.andamento(indice / total, f"Página {indice + 1} de {total}")
            pagina = doc[indice]

            for texto, vertical in ((cabecalho, "cima"), (rodape, "baixo")):
                if not texto:
                    continue
                escrito = _texto_do_numero(texto, indice + 1, total)
                largura = pymupdf.get_text_length(escrito, fontname=fonte, fontsize=tamanho)
                pagina.insert_text(
                    _ponto(pagina.rect, vertical, alinhamento, margem, tamanho, largura),
                    escrito,
                    fontname=fonte,
                    fontsize=tamanho,
                    color=(0.25, 0.25, 0.25),
                )

        destino = pedido.saida or nome_com_sufixo(origem, "cabecalho")
        bytes_saida = salvar(doc, destino, senha)

        pedido.andamento(1.0)
        return {
            "arquivo": destino,
            "paginas": total,
            "bytes": bytes_saida,
            "notas": ["Dá para usar {n} e {total} no texto, que viram o número da página e o total."],
        }
    finally:
        doc.close()


def _cor(nome: str) -> Tuple[float, float, float]:
    return {
        "cinza": (0.5, 0.5, 0.5),
        "preto": (0, 0, 0),
        "vermelho": (0.8, 0.1, 0.15),
        "azul": (0.1, 0.3, 0.7),
    }.get(nome, (0.5, 0.5, 0.5))
