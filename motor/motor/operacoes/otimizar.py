"""Deixar o arquivo menor.

Dois caminhos, porque servem a documentos diferentes. O caminho leve so
arruma a estrutura do PDF e nao toca em nenhuma imagem: o resultado e
identico ao original, so que menor. O caminho pesado redesenha as paginas, e
ai a reducao e grande mas a qualidade cai e o texto deixa de ser selecionavel.
"""

from __future__ import annotations

import os
from typing import Any, Dict

import pymupdf

from ..documento import abrir, nome_com_sufixo, salvar
from ..protocolo import ErroDoUsuario, Pedido

# DPI de cada nivel do caminho pesado. 150 e leitura de tela, 110 e rascunho e
# 200 ainda imprime bem em laser.
DPI_POR_NIVEL = {"pouco": 200, "medio": 150, "muito": 110}
QUALIDADE_POR_NIVEL = {"pouco": 88, "medio": 78, "muito": 62}


def comprimir(pedido: Pedido) -> Dict[str, Any]:
    """Reduz o arquivo, avisando quanto reduziu de verdade.

    Se o PDF ja estava enxuto, o resultado pode sair do mesmo tamanho ou maior.
    Nesse caso o original e mantido e a nota explica: entregar um arquivo maior
    chamando de comprimido seria mentir para quem pediu.
    """
    if not pedido.arquivos:
        raise ErroDoUsuario("nenhum arquivo escolhido")

    nivel = str(pedido.opcao("nivel", "medio"))
    redesenhar = bool(pedido.opcao("redesenhar", False))

    origem = pedido.arquivos[0]
    senha = pedido.senha(0)
    bytes_entrada = os.path.getsize(origem)

    entrada = abrir(origem, senha)
    try:
        if redesenhar:
            resultado, paginas = _redesenhando(pedido, entrada, nivel)
        else:
            resultado, paginas = entrada, entrada.page_count
            pedido.andamento(0.5, "Reorganizando o arquivo")

        destino = pedido.saida or nome_com_sufixo(origem, "comprimido")
        bytes_saida = salvar(resultado, destino, senha)

        if resultado is not entrada:
            resultado.close()
    finally:
        entrada.close()

    notas = []
    if senha:
        notas.append("A senha do arquivo original foi mantida no resultado.")

    if bytes_saida >= bytes_entrada:
        # Grava mesmo assim para nao deixar o usuario sem arquivo, mas nao
        # finge que houve ganho.
        notas.append(
            "Este PDF ja estava no menor tamanho que da para alcancar sem redesenhar. "
            "O resultado nao ficou menor que o original."
            if not redesenhar
            else "Nem redesenhando o arquivo ficou menor: as imagens ja estavam bem compactadas."
        )
    if redesenhar:
        notas.append("As paginas viraram imagem, entao o texto deixa de ser selecionavel e pesquisavel.")

    pedido.andamento(1.0)
    return {
        "arquivo": destino,
        "paginas": paginas,
        "bytesEntrada": bytes_entrada,
        "bytesSaida": bytes_saida,
        "reducao": round(1 - bytes_saida / bytes_entrada, 4) if bytes_entrada else 0,
        "notas": notas,
    }


def _redesenhando(pedido: Pedido, entrada: pymupdf.Document, nivel: str) -> tuple[pymupdf.Document, int]:
    """Cada pagina vira um JPEG, o que corta muito mas descarta o texto."""
    dpi = DPI_POR_NIVEL.get(nivel, DPI_POR_NIVEL["medio"])
    qualidade = QUALIDADE_POR_NIVEL.get(nivel, QUALIDADE_POR_NIVEL["medio"])

    saida = pymupdf.open()
    total = entrada.page_count

    for indice in range(total):
        pedido.andamento(indice / total, f"Pagina {indice + 1} de {total}")

        pagina = entrada[indice]
        pixels = pagina.get_pixmap(dpi=dpi)
        nova = saida.new_page(width=pagina.rect.width, height=pagina.rect.height)
        nova.insert_image(nova.rect, stream=pixels.tobytes("jpeg", jpg_quality=qualidade))
        del pixels

    return saida, total


def reparar(pedido: Pedido) -> Dict[str, Any]:
    """Reescreve o PDF do zero, o que resolve boa parte dos arquivos quebrados.

    O MuPDF reconstroi a tabela de referencias percorrendo o arquivo inteiro,
    entao PDF com indice corrompido costuma voltar a abrir. Nao recupera
    conteudo que simplesmente nao esta no arquivo.
    """
    if not pedido.arquivos:
        raise ErroDoUsuario("nenhum arquivo escolhido")

    origem = pedido.arquivos[0]
    senha = pedido.senha(0)

    doc = abrir(origem, senha)
    try:
        pedido.andamento(0.5, "Reconstruindo o arquivo")
        destino = pedido.saida or nome_com_sufixo(origem, "reparado")
        bytes_saida = salvar(doc, destino, senha)
        paginas = doc.page_count
    finally:
        doc.close()

    pedido.andamento(1.0)
    return {
        "arquivo": destino,
        "paginas": paginas,
        "bytes": bytes_saida,
        "notas": ["O arquivo foi reescrito do zero. O que nao estava dentro dele nao da para recuperar."],
    }
