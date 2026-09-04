"""Desenhar paginas como imagem.

Serve a miniatura da tela, a previa da impressao e a propria impressao. E o
lugar onde o PyMuPDF paga por si: nesta maquina, 141 paginas a 150 DPI sairam
em 39 s aqui contra 168 s no pdf.js, com o JPEG do mesmo tamanho.
"""

from __future__ import annotations

import os
from typing import Any, Dict

import pymupdf

from ..resolucao import couber, na_faixa
from ..documento import abrir, faixa_de_paginas
from ..protocolo import ErroDoUsuario, Pedido

# Acima de 300 DPI o arquivo cresce em quadrado e a impressora nao aproveita:
# laser de escritorio imprime 600 DPI de tracado, nao de foto.
DPI_MAXIMO = 300
DPI_MINIMO = 36


def desenhar(pedido: Pedido) -> Dict[str, Any]:
    """Grava uma imagem por pagina e devolve os caminhos.

    Grava em disco em vez de devolver os bytes porque uma previa de 141 paginas
    passaria dezenas de megabytes por dentro do canal de texto, e o aplicativo
    so precisa saber onde as imagens estao.
    """
    if not pedido.arquivos:
        raise ErroDoUsuario("nenhum arquivo para desenhar")

    destino = pedido.saida
    if not destino:
        raise ErroDoUsuario("faltou dizer em que pasta gravar as imagens")
    os.makedirs(destino, exist_ok=True)

    dpi = na_faixa(pedido.opcao("dpi", 150), 150)
    formato = str(pedido.opcao("formato", "jpeg")).lower()
    qualidade = max(30, min(100, int(pedido.opcao("qualidade", 82))))
    cinza = bool(pedido.opcao("cinza", False))

    doc = abrir(pedido.arquivos[0], pedido.senha(0))
    try:
        escolhidas = faixa_de_paginas(str(pedido.opcao("paginas", "")), doc.page_count)
        espaco = pymupdf.csGRAY if cinza else pymupdf.csRGB
        imagens = []

        for posicao, indice in enumerate(escolhidas):
            pedido.andamento(posicao / len(escolhidas), f"Pagina {posicao + 1} de {len(escolhidas)}")

            pagina = doc[indice]
            usado, _ = couber(pagina.rect.width, pagina.rect.height, dpi, 1 if cinza else 3)
            pixels = pagina.get_pixmap(dpi=usado, colorspace=espaco)
            arquivo = os.path.join(destino, f"p{indice + 1:05d}.{'jpg' if formato == 'jpeg' else 'png'}")

            if formato == "jpeg":
                pixels.save(arquivo, jpg_quality=qualidade)
            else:
                pixels.save(arquivo)

            imagens.append(
                {
                    "pagina": indice + 1,
                    "caminho": arquivo,
                    "largura": pixels.width,
                    "altura": pixels.height,
                    "bytes": os.path.getsize(arquivo),
                }
            )
            # Solta o mapa de pixels antes da proxima pagina. Uma pagina A3 a
            # 300 DPI ocupa uns 50 MB; segurar duas ja aperta numa maquina de
            # 4 GB.
            del pixels

        pedido.andamento(1.0)
        return {"dpi": dpi, "imagens": imagens}
    finally:
        doc.close()
