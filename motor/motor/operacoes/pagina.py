"""Mexer no tamanho e no arranjo das páginas.

Todas usam `show_pdf_page`, que coloca uma página de um documento dentro de um
retângulo de outro sem rasterizar nada: o texto continua texto, a qualidade não
muda e o arquivo não incha. É a diferença entre montar um livreto de verdade e
tirar foto das páginas.
"""

from __future__ import annotations

from typing import Any, Dict, List, Tuple

import pymupdf

from ..documento import abrir, faixa_de_paginas, nome_com_sufixo, salvar
from ..protocolo import ErroDoUsuario, Pedido

PONTOS_POR_MM = 72 / 25.4

# Os papéis em pontos, já na orientação retrato.
PAPEIS: Dict[str, Tuple[float, float]] = {
    "A3": (841.89, 1190.55),
    "A4": (595.28, 841.89),
    "A5": (419.53, 595.28),
    "carta": (612, 792),
    "oficio": (612, 1008),
}

# Quantas páginas por folha, e em que grade cada quantidade vira.
GRADES: Dict[int, Tuple[int, int]] = {
    2: (1, 2),
    4: (2, 2),
    6: (2, 3),
    8: (2, 4),
    9: (3, 3),
    16: (4, 4),
}


def _dimensoes(nome: str, deitado: bool) -> Tuple[float, float]:
    papel = PAPEIS.get(nome)
    if papel is None:
        raise ErroDoUsuario(f"não conheço o papel {nome}")
    return (papel[1], papel[0]) if deitado else papel


def _encaixe(destino: pymupdf.Rect, origem: pymupdf.Rect) -> pymupdf.Rect:
    """Onde a página cabe dentro do quadro, inteira e centrada.

    Cortar para preencher seria pior aqui: numa folha 2-em-1 o que se perde no
    corte é a margem do documento, e é lá que costuma estar o número da página.
    """
    escala = min(destino.width / origem.width, destino.height / origem.height)
    largura = origem.width * escala
    altura = origem.height * escala

    x = destino.x0 + (destino.width - largura) / 2
    y = destino.y0 + (destino.height - altura) / 2
    return pymupdf.Rect(x, y, x + largura, y + altura)


def varias_por_folha(pedido: Pedido) -> Dict[str, Any]:
    """Junta 2, 4, 6, 8, 9 ou 16 páginas numa folha só.

    Economiza papel em rascunho e em prova de leitura. A ordem é a de leitura:
    esquerda para a direita, de cima para baixo.
    """
    if not pedido.arquivos:
        raise ErroDoUsuario("nenhum arquivo escolhido")

    por_folha = int(pedido.opcao("porFolha", 2))
    grade = GRADES.get(por_folha)
    if grade is None:
        raise ErroDoUsuario(f"não sei montar {por_folha} por folha; use {', '.join(map(str, GRADES))}")

    colunas, linhas = grade
    margem = float(pedido.opcao("margem", 8)) * PONTOS_POR_MM
    espaco = float(pedido.opcao("espaco", 4)) * PONTOS_POR_MM
    borda = bool(pedido.opcao("borda", False))

    origem = pedido.arquivos[0]
    senha = pedido.senha(0)
    entrada = abrir(origem, senha)
    saida = pymupdf.open()

    try:
        # A folha fica deitada quando a grade é mais larga que alta: 2-em-1 de
        # páginas retrato cabe muito melhor numa folha deitada.
        deitado = colunas > linhas or (por_folha == 2)
        largura_folha, altura_folha = _dimensoes(str(pedido.opcao("papel", "A4")), deitado)

        total = entrada.page_count
        folhas = 0

        for comeco in range(0, total, por_folha):
            pedido.andamento(comeco / total, f"Página {comeco + 1} de {total}")
            folha = saida.new_page(width=largura_folha, height=altura_folha)
            folhas += 1

            util_x = (largura_folha - 2 * margem - (colunas - 1) * espaco) / colunas
            util_y = (altura_folha - 2 * margem - (linhas - 1) * espaco) / linhas

            for posicao in range(por_folha):
                indice = comeco + posicao
                if indice >= total:
                    break

                coluna = posicao % colunas
                linha = posicao // colunas
                quadro = pymupdf.Rect(
                    margem + coluna * (util_x + espaco),
                    margem + linha * (util_y + espaco),
                    margem + coluna * (util_x + espaco) + util_x,
                    margem + linha * (util_y + espaco) + util_y,
                )

                folha.show_pdf_page(_encaixe(quadro, entrada[indice].rect), entrada, indice)
                if borda:
                    folha.draw_rect(quadro, color=(0.75, 0.75, 0.75), width=0.4)

        destino = pedido.saida or nome_com_sufixo(origem, f"{por_folha}-por-folha")
        bytes_saida = salvar(saida, destino, senha)

        pedido.andamento(1.0)
        return {
            "arquivo": destino,
            "paginas": folhas,
            "bytes": bytes_saida,
            "notas": [f"{total} páginas viraram {folhas} folhas, {por_folha} por folha."],
        }
    finally:
        saida.close()
        entrada.close()


def livreto(pedido: Pedido) -> Dict[str, Any]:
    """Reordena para grampear no meio e dobrar.

    Numa revista grampeada, a folha de fora carrega a primeira e a última
    página juntas. A conta é essa: as páginas saem pareadas do lado de fora
    para dentro, e o total é completado com páginas em branco até virar
    múltiplo de quatro, senão a dobra não fecha.
    """
    if not pedido.arquivos:
        raise ErroDoUsuario("nenhum arquivo escolhido")

    origem = pedido.arquivos[0]
    senha = pedido.senha(0)
    entrada = abrir(origem, senha)
    saida = pymupdf.open()

    try:
        total = entrada.page_count
        completo = total + (-total % 4)

        # Fora, dentro, fora, dentro: 1 com a última, 2 com a penúltima.
        ordem: List[int | None] = []
        esquerda, direita = 0, completo - 1
        while esquerda < direita:
            ordem.extend([direita, esquerda, esquerda + 1, direita - 1])
            esquerda += 2
            direita -= 2

        primeira = entrada[0].rect
        largura_folha = primeira.width * 2
        altura_folha = primeira.height

        for posicao in range(0, len(ordem), 2):
            pedido.andamento(posicao / len(ordem), f"Folha {posicao // 2 + 1} de {len(ordem) // 2}")
            folha = saida.new_page(width=largura_folha, height=altura_folha)

            for lado, indice in enumerate(ordem[posicao : posicao + 2]):
                if indice is None or indice >= total:
                    continue  # página em branco do enchimento
                quadro = pymupdf.Rect(lado * primeira.width, 0, (lado + 1) * primeira.width, altura_folha)
                folha.show_pdf_page(_encaixe(quadro, entrada[indice].rect), entrada, indice)

        destino = pedido.saida or nome_com_sufixo(origem, "livreto")
        bytes_saida = salvar(saida, destino, senha)

        # O arquivo tem um lado impresso por página; a folha de papel física
        # leva dois desses lados (frente e verso). "1 de 8" e "8 de 1" saem no
        # mesmo lado porque são a folha mais externa do miolo.
        fisicas = saida.page_count // 2

        pedido.andamento(1.0)
        return {
            "arquivo": destino,
            "paginas": saida.page_count,
            "folhasFisicas": fisicas,
            "bytes": bytes_saida,
            "notas": [
                f"{total} páginas viraram {saida.page_count} lados de impressão, "
                f"que saem em {fisicas} folha{'s' if fisicas != 1 else ''} de papel duplex."
                + (f" Entraram {completo - total} páginas em branco para fechar a dobra." if completo != total else ""),
                "Imprima frente e verso, virando pela borda curta, e dobre no meio.",
            ],
        }
    finally:
        saida.close()
        entrada.close()


def dividir_paginas(pedido: Pedido) -> Dict[str, Any]:
    """Corta cada página em duas.

    Serve para o contrário do livreto: digitalização de livro aberto, em que
    duas páginas vieram numa imagem só.
    """
    if not pedido.arquivos:
        raise ErroDoUsuario("nenhum arquivo escolhido")

    na_vertical = str(pedido.opcao("sentido", "vertical")) == "vertical"
    origem = pedido.arquivos[0]
    senha = pedido.senha(0)

    entrada = abrir(origem, senha)
    saida = pymupdf.open()
    try:
        total = entrada.page_count
        for indice in range(total):
            pedido.andamento(indice / total, f"Página {indice + 1} de {total}")
            caixa = entrada[indice].rect

            if na_vertical:
                metades = [
                    pymupdf.Rect(caixa.x0, caixa.y0, caixa.x0 + caixa.width / 2, caixa.y1),
                    pymupdf.Rect(caixa.x0 + caixa.width / 2, caixa.y0, caixa.x1, caixa.y1),
                ]
            else:
                metades = [
                    pymupdf.Rect(caixa.x0, caixa.y0, caixa.x1, caixa.y0 + caixa.height / 2),
                    pymupdf.Rect(caixa.x0, caixa.y0 + caixa.height / 2, caixa.x1, caixa.y1),
                ]

            for metade in metades:
                nova = saida.new_page(width=metade.width, height=metade.height)
                nova.show_pdf_page(nova.rect, entrada, indice, clip=metade)

        destino = pedido.saida or nome_com_sufixo(origem, "dividido")
        bytes_saida = salvar(saida, destino, senha)

        pedido.andamento(1.0)
        return {
            "arquivo": destino,
            "paginas": saida.page_count,
            "bytes": bytes_saida,
            "notas": [f"{total} páginas viraram {saida.page_count}."],
        }
    finally:
        saida.close()
        entrada.close()


def cortar(pedido: Pedido) -> Dict[str, Any]:
    """Apara as bordas, em milímetros.

    Só muda a área visível; o conteúdo aparado continua dentro do arquivo. É o
    comportamento do PDF, e é o que permite desfazer depois.
    """
    if not pedido.arquivos:
        raise ErroDoUsuario("nenhum arquivo escolhido")

    lados = {
        lado: float(pedido.opcao(lado, 0)) * PONTOS_POR_MM
        for lado in ("esquerda", "direita", "topo", "base")
    }

    origem = pedido.arquivos[0]
    senha = pedido.senha(0)
    doc = abrir(origem, senha)
    try:
        escolhidas = faixa_de_paginas(str(pedido.opcao("paginas", "")), doc.page_count)

        for posicao, indice in enumerate(escolhidas):
            pedido.andamento(posicao / len(escolhidas), f"Página {posicao + 1} de {len(escolhidas)}")
            pagina = doc[indice]
            caixa = pagina.rect

            nova = pymupdf.Rect(
                caixa.x0 + lados["esquerda"],
                caixa.y0 + lados["topo"],
                caixa.x1 - lados["direita"],
                caixa.y1 - lados["base"],
            )
            if nova.width <= 1 or nova.height <= 1:
                raise ErroDoUsuario("esse corte não deixaria nada da página; diminua as medidas")
            pagina.set_cropbox(nova)

        destino = pedido.saida or nome_com_sufixo(origem, "cortado")
        bytes_saida = salvar(doc, destino, senha)

        pedido.andamento(1.0)
        return {
            "arquivo": destino,
            "paginas": len(escolhidas),
            "bytes": bytes_saida,
            "notas": ["O que foi aparado continua no arquivo, só deixou de aparecer."],
        }
    finally:
        doc.close()


def redimensionar(pedido: Pedido) -> Dict[str, Any]:
    """Passa o documento para outro tamanho de papel, sem esticar nada."""
    if not pedido.arquivos:
        raise ErroDoUsuario("nenhum arquivo escolhido")

    nome_papel = str(pedido.opcao("papel", "A4"))
    manter_orientacao = bool(pedido.opcao("manterOrientacao", True))
    margem = float(pedido.opcao("margem", 0)) * PONTOS_POR_MM

    origem = pedido.arquivos[0]
    senha = pedido.senha(0)
    entrada = abrir(origem, senha)
    saida = pymupdf.open()

    try:
        total = entrada.page_count
        for indice in range(total):
            pedido.andamento(indice / total, f"Página {indice + 1} de {total}")
            caixa = entrada[indice].rect
            deitado = manter_orientacao and caixa.width > caixa.height
            largura, altura = _dimensoes(nome_papel, deitado)

            nova = saida.new_page(width=largura, height=altura)
            quadro = pymupdf.Rect(margem, margem, largura - margem, altura - margem)
            nova.show_pdf_page(_encaixe(quadro, caixa), entrada, indice)

        destino = pedido.saida or nome_com_sufixo(origem, nome_papel.lower())
        bytes_saida = salvar(saida, destino, senha)

        pedido.andamento(1.0)
        return {
            "arquivo": destino,
            "paginas": total,
            "bytes": bytes_saida,
            "notas": [f"Tudo passou para {nome_papel}, com a proporção original mantida."],
        }
    finally:
        saida.close()
        entrada.close()
