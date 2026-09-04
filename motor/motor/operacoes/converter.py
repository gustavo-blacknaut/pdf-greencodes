"""PDF para imagem, imagem para PDF, e extrair as imagens de dentro do PDF.

As duas primeiras são o mesmo problema visto de dois lados: uma página vira
uma imagem, ou uma imagem vira uma página. A terceira é diferente — não pega
a página inteira, pega só os objetos de imagem que estão embutidos nela.
"""

from __future__ import annotations

import os
from typing import Any, Dict

import pymupdf

from ..documento import abrir, faixa_de_paginas, nome_com_sufixo, salvar
from ..resolucao import couber, na_faixa
from ..protocolo import ErroDoUsuario, Pedido

DPI_PADRAO = 200
DPI_MINIMO = 72
DPI_MAXIMO = 600


def pdf_para_imagem(pedido: Pedido) -> Dict[str, Any]:
    """Uma imagem por página, num arquivo cada.

    Difere de `desenhar` (que serve a prévia de impressão e grava num nome
    fixo) por gerar nomes que fazem sentido fora do aplicativo — é para a
    pessoa levar essas imagens para outro lugar.
    """
    if not pedido.arquivos:
        raise ErroDoUsuario("nenhum arquivo escolhido")

    origem = pedido.arquivos[0]
    senha = pedido.senha(0)
    formato = str(pedido.opcao("formato", "jpeg")).lower()
    qualidade = max(30, min(100, int(pedido.opcao("qualidade", 90))))
    dpi = na_faixa(pedido.opcao("dpi", DPI_PADRAO), DPI_PADRAO)
    extensao = "jpg" if formato == "jpeg" else "png"

    doc = abrir(origem, senha)
    try:
        escolhidas = faixa_de_paginas(str(pedido.opcao("paginas", "")), doc.page_count)
        base, _ = os.path.splitext(origem)

        pasta = pedido.saida or f"{base}-imagens"
        os.makedirs(pasta, exist_ok=True)

        gerados = []
        for posicao, indice in enumerate(escolhidas):
            pedido.andamento(posicao / len(escolhidas), f"Página {posicao + 1} de {len(escolhidas)}")

            caixa = doc[indice].rect
            usado, _ = couber(caixa.width, caixa.height, dpi)
            pixels = doc[indice].get_pixmap(dpi=usado)
            destino = os.path.join(pasta, f"pagina-{indice + 1:03d}.{extensao}")

            if formato == "jpeg":
                pixels.save(destino, jpg_quality=qualidade)
            else:
                pixels.save(destino)

            gerados.append({"arquivo": destino, "pagina": indice + 1, "bytes": os.path.getsize(destino)})

        pedido.andamento(1.0)
        return {"arquivos": gerados, "paginas": len(gerados)}
    finally:
        doc.close()


def imagem_para_pdf(pedido: Pedido) -> Dict[str, Any]:
    """Uma ou mais imagens, uma por página, na ordem em que chegaram.

    Cada página sai do tamanho da própria imagem — sem esticar nem cortar — e
    fica 210 mm de largura no PDF, mantendo a proporção original. É a mesma
    conta que uma folha A4 usaria para uma imagem em pé.
    """
    if not pedido.arquivos:
        raise ErroDoUsuario("nenhuma imagem escolhida")

    largura_pt = 210 * 72 / 25.4  # 210 mm, a largura de uma A4

    saida = pymupdf.open()
    try:
        for indice, caminho in enumerate(pedido.arquivos):
            pedido.andamento(indice / len(pedido.arquivos), f"Imagem {indice + 1} de {len(pedido.arquivos)}")

            if not os.path.exists(caminho):
                raise ErroDoUsuario(f"não encontrei a imagem: {os.path.basename(caminho)}")

            try:
                origem = pymupdf.open(caminho)
            except Exception as erro:  # noqa: BLE001
                raise ErroDoUsuario(f"não consegui abrir {os.path.basename(caminho)}: {erro}") from erro

            with origem:
                proporcao = origem[0].rect.height / origem[0].rect.width

            # show_pdf_page copia conteúdo de PDF; uma imagem crua aberta
            # como "documento de uma página" não tem esse conteúdo, então
            # entra por insert_image, que é o caminho certo para raster.
            pagina = saida.new_page(width=largura_pt, height=largura_pt * proporcao)
            pagina.insert_image(pagina.rect, filename=caminho)

        destino = pedido.saida or nome_com_sufixo(pedido.arquivos[0], "convertido", ".pdf")
        bytes_saida = salvar(saida, destino)

        pedido.andamento(1.0)
        return {"arquivo": destino, "paginas": saida.page_count, "bytes": bytes_saida}
    finally:
        saida.close()


def extrair_imagens(pedido: Pedido) -> Dict[str, Any]:
    """Pega as imagens embutidas no PDF, sem redesenhar a página.

    É diferente de `pdf-para-imagem`: aquele fotografa a página inteira, este
    pega só os objetos de imagem que já estavam lá dentro — na resolução
    original, sem perder qualidade rasterizando de novo.
    """
    if not pedido.arquivos:
        raise ErroDoUsuario("nenhum arquivo escolhido")

    origem = pedido.arquivos[0]
    senha = pedido.senha(0)

    doc = abrir(origem, senha)
    try:
        base, _ = os.path.splitext(origem)
        pasta = pedido.saida or f"{base}-imagens-extraidas"
        os.makedirs(pasta, exist_ok=True)

        gerados = []
        total = doc.page_count
        vistas = set()

        for indice in range(total):
            pedido.andamento(indice / total, f"Página {indice + 1} de {total}")

            for imagem in doc[indice].get_images(full=True):
                xref = imagem[0]
                if xref in vistas:
                    continue  # a mesma imagem pode se repetir em várias páginas (cabeçalho, logo)
                vistas.add(xref)

                info = doc.extract_image(xref)
                destino = os.path.join(pasta, f"imagem-{len(gerados) + 1:03d}.{info['ext']}")
                with open(destino, "wb") as arquivo:
                    arquivo.write(info["image"])

                gerados.append({"arquivo": destino, "pagina": indice + 1, "bytes": os.path.getsize(destino)})

        pedido.andamento(1.0)
        if not gerados:
            return {"arquivos": [], "notas": ["Esse PDF não tem nenhuma imagem embutida — só texto vetorial."]}
        return {"arquivos": gerados}
    finally:
        doc.close()
