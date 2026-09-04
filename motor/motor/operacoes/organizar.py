"""Mexer nas paginas sem redesenhar nada.

Estas operacoes copiam os objetos do PDF de um documento para outro, entao o
texto continua texto e a qualidade nao muda. Sao rapidas mesmo em documento
grande porque nao ha nada para rasterizar.
"""

from __future__ import annotations

import os
from typing import Any, Dict

import pymupdf

from ..documento import abrir, faixa_de_paginas, nome_com_sufixo, salvar
from ..protocolo import ErroDoUsuario, Pedido

# Quantas paginas copiar antes de avisar o andamento. Avisar a cada pagina num
# documento de mil geraria mais mensagem que trabalho.
LOTE = 25


def juntar(pedido: Pedido) -> Dict[str, Any]:
    """Um PDF so, na ordem em que os arquivos chegaram.

    A senha do resultado e a do primeiro arquivo: e o unico criterio que nao
    exige adivinhar a intencao quando os arquivos vem com senhas diferentes.
    """
    if len(pedido.arquivos) < 2:
        raise ErroDoUsuario("juntar precisa de pelo menos dois arquivos")

    saida = pymupdf.open()
    paginas = 0
    try:
        for indice, caminho in enumerate(pedido.arquivos):
            pedido.andamento(indice / len(pedido.arquivos), f"Arquivo {indice + 1} de {len(pedido.arquivos)}")

            entrada = abrir(caminho, pedido.senha(indice))
            try:
                saida.insert_pdf(entrada)
                paginas += entrada.page_count
            finally:
                entrada.close()

        destino = pedido.saida or nome_com_sufixo(pedido.arquivos[0], "unido")
        bytes_saida = salvar(saida, destino, pedido.senha(0))
        pedido.andamento(1.0)
        return {"arquivo": destino, "paginas": paginas, "bytes": bytes_saida}
    finally:
        saida.close()


def extrair(pedido: Pedido) -> Dict[str, Any]:
    """So as paginas pedidas, na ordem em que foram pedidas."""
    if not pedido.arquivos:
        raise ErroDoUsuario("nenhum arquivo escolhido")

    origem = pedido.arquivos[0]
    senha = pedido.senha(0)
    entrada = abrir(origem, senha)
    try:
        escolhidas = faixa_de_paginas(str(pedido.opcao("paginas", "")), entrada.page_count)

        saida = pymupdf.open()
        for posicao, indice in enumerate(escolhidas):
            if posicao % LOTE == 0:
                pedido.andamento(posicao / len(escolhidas), f"Pagina {posicao + 1} de {len(escolhidas)}")
            saida.insert_pdf(entrada, from_page=indice, to_page=indice)

        destino = pedido.saida or nome_com_sufixo(origem, "paginas")
        bytes_saida = salvar(saida, destino, senha)
        saida.close()

        pedido.andamento(1.0)
        return {"arquivo": destino, "paginas": len(escolhidas), "bytes": bytes_saida}
    finally:
        entrada.close()


def remover(pedido: Pedido) -> Dict[str, Any]:
    """Tudo menos as paginas pedidas."""
    if not pedido.arquivos:
        raise ErroDoUsuario("nenhum arquivo escolhido")

    origem = pedido.arquivos[0]
    senha = pedido.senha(0)
    entrada = abrir(origem, senha)
    try:
        fora = set(faixa_de_paginas(str(pedido.opcao("paginas", "")), entrada.page_count))
        ficam = [i for i in range(entrada.page_count) if i not in fora]
        if not ficam:
            raise ErroDoUsuario("isso removeria todas as paginas do documento")

        saida = pymupdf.open()
        for posicao, indice in enumerate(ficam):
            if posicao % LOTE == 0:
                pedido.andamento(posicao / len(ficam), f"Pagina {posicao + 1} de {len(ficam)}")
            saida.insert_pdf(entrada, from_page=indice, to_page=indice)

        destino = pedido.saida or nome_com_sufixo(origem, "sem-paginas")
        bytes_saida = salvar(saida, destino, senha)
        saida.close()

        pedido.andamento(1.0)
        return {"arquivo": destino, "paginas": len(ficam), "removidas": len(fora), "bytes": bytes_saida}
    finally:
        entrada.close()


def girar(pedido: Pedido) -> Dict[str, Any]:
    """Gira as paginas escolhidas, somando ao giro que ja existia.

    Somar em vez de definir importa em documento digitalizado torto, onde
    algumas paginas ja vem com giro gravado e outras nao.
    """
    if not pedido.arquivos:
        raise ErroDoUsuario("nenhum arquivo escolhido")

    graus = int(pedido.opcao("graus", 90))
    if graus % 90 != 0:
        raise ErroDoUsuario("o giro precisa ser multiplo de 90 graus")

    origem = pedido.arquivos[0]
    senha = pedido.senha(0)
    doc = abrir(origem, senha)
    try:
        escolhidas = faixa_de_paginas(str(pedido.opcao("paginas", "")), doc.page_count)
        for posicao, indice in enumerate(escolhidas):
            if posicao % LOTE == 0:
                pedido.andamento(posicao / len(escolhidas), f"Pagina {posicao + 1} de {len(escolhidas)}")
            pagina = doc[indice]
            pagina.set_rotation((pagina.rotation + graus) % 360)

        destino = pedido.saida or nome_com_sufixo(origem, "girado")
        bytes_saida = salvar(doc, destino, senha)

        pedido.andamento(1.0)
        return {"arquivo": destino, "paginas": len(escolhidas), "bytes": bytes_saida}
    finally:
        doc.close()


def dividir(pedido: Pedido) -> Dict[str, Any]:
    """Quebra em varios arquivos de N paginas cada."""
    if not pedido.arquivos:
        raise ErroDoUsuario("nenhum arquivo escolhido")

    por_arquivo = max(1, int(pedido.opcao("porArquivo", 1)))
    origem = pedido.arquivos[0]
    senha = pedido.senha(0)

    entrada = abrir(origem, senha)
    try:
        total = entrada.page_count
        pedacos = []

        for comeco in range(0, total, por_arquivo):
            pedido.andamento(comeco / total, f"Pagina {comeco + 1} de {total}")
            fim = min(comeco + por_arquivo - 1, total - 1)

            saida = pymupdf.open()
            saida.insert_pdf(entrada, from_page=comeco, to_page=fim)

            rotulo = f"{comeco + 1}" if comeco == fim else f"{comeco + 1}-{fim + 1}"
            destino = nome_com_sufixo(origem, f"paginas-{rotulo}")
            if pedido.saida:
                destino = os.path.join(pedido.saida, os.path.basename(destino))

            bytes_saida = salvar(saida, destino, senha)
            saida.close()
            pedacos.append({"arquivo": destino, "paginas": fim - comeco + 1, "bytes": bytes_saida})

        pedido.andamento(1.0)
        return {"arquivos": pedacos, "paginas": total}
    finally:
        entrada.close()


def inverter_paginas(pedido: Pedido) -> Dict[str, Any]:
    """A última página vira a primeira, e assim por diante."""
    if not pedido.arquivos:
        raise ErroDoUsuario("nenhum arquivo escolhido")

    origem = pedido.arquivos[0]
    senha = pedido.senha(0)
    entrada = abrir(origem, senha)
    try:
        total = entrada.page_count
        saida = pymupdf.open()

        for posicao, indice in enumerate(range(total - 1, -1, -1)):
            if posicao % LOTE == 0:
                pedido.andamento(posicao / total, f"Página {posicao + 1} de {total}")
            saida.insert_pdf(entrada, from_page=indice, to_page=indice)

        destino = pedido.saida or nome_com_sufixo(origem, "invertido")
        bytes_saida = salvar(saida, destino, senha)
        saida.close()

        pedido.andamento(1.0)
        return {"arquivo": destino, "paginas": total, "bytes": bytes_saida}
    finally:
        entrada.close()


def intercalar(pedido: Pedido) -> Dict[str, Any]:
    """Alterna página a página entre dois arquivos: 1º do A, 1º do B, 2º do A...

    Existe para juntar duas digitalizações de um documento frente-e-verso
    feitas num scanner que só lê um lado: um passe pega as páginas ímpares na
    ordem, o outro pega as pares — e quase sempre vem ao contrário, porque a
    pilha foi virada para escanear o verso. `inverterSegundo` desfaz isso
    antes de intercalar.
    """
    if len(pedido.arquivos) != 2:
        raise ErroDoUsuario("intercalar precisa de exatamente dois arquivos")

    inverter_segundo = bool(pedido.opcao("inverterSegundo", False))

    primeiro = abrir(pedido.arquivos[0], pedido.senha(0))
    segundo = abrir(pedido.arquivos[1], pedido.senha(1))
    try:
        ordem_segundo = list(range(segundo.page_count))
        if inverter_segundo:
            ordem_segundo.reverse()

        total = max(primeiro.page_count, segundo.page_count)
        saida = pymupdf.open()

        for posicao in range(total):
            if posicao % LOTE == 0:
                pedido.andamento(posicao / total, f"Página {posicao + 1} de {total}")

            if posicao < primeiro.page_count:
                saida.insert_pdf(primeiro, from_page=posicao, to_page=posicao)
            if posicao < len(ordem_segundo):
                indice = ordem_segundo[posicao]
                saida.insert_pdf(segundo, from_page=indice, to_page=indice)

        destino = pedido.saida or nome_com_sufixo(pedido.arquivos[0], "intercalado")
        paginas = saida.page_count
        bytes_saida = salvar(saida, destino, pedido.senha(0))
        saida.close()

        pedido.andamento(1.0)
        return {"arquivo": destino, "paginas": paginas, "bytes": bytes_saida}
    finally:
        primeiro.close()
        segundo.close()


def separar_pares_impares(pedido: Pedido) -> Dict[str, Any]:
    """Dois arquivos: um só com as páginas ímpares, outro só com as pares."""
    if not pedido.arquivos:
        raise ErroDoUsuario("nenhum arquivo escolhido")

    origem = pedido.arquivos[0]
    senha = pedido.senha(0)
    entrada = abrir(origem, senha)
    try:
        total = entrada.page_count
        gerados = []

        for sufixo, indices in (("impares", range(0, total, 2)), ("pares", range(1, total, 2))):
            saida = pymupdf.open()
            for indice in indices:
                saida.insert_pdf(entrada, from_page=indice, to_page=indice)

            if saida.page_count == 0:
                saida.close()
                continue

            destino = nome_com_sufixo(origem, sufixo)
            if pedido.saida:
                destino = os.path.join(pedido.saida, os.path.basename(destino))
            bytes_saida = salvar(saida, destino, senha)
            paginas = saida.page_count
            saida.close()
            gerados.append({"arquivo": destino, "paginas": paginas, "bytes": bytes_saida})

        pedido.andamento(1.0)
        return {"arquivos": gerados, "paginas": total}
    finally:
        entrada.close()


def paginas_em_branco(pedido: Pedido) -> Dict[str, Any]:
    """Insere página em branco depois de cada página pedida — ou uma no fim, se nenhuma for pedida.

    O tamanho da página em branco é o da página anterior a ela, para não
    destoar num documento com formatos diferentes por seção.
    """
    if not pedido.arquivos:
        raise ErroDoUsuario("nenhum arquivo escolhido")

    origem = pedido.arquivos[0]
    senha = pedido.senha(0)
    entrada = abrir(origem, senha)
    try:
        total = entrada.page_count
        texto_posicoes = str(pedido.opcao("apos", "")).strip()
        depois_de = set(faixa_de_paginas(texto_posicoes, total)) if texto_posicoes else {total - 1}

        saida = pymupdf.open()
        inseridas = 0

        for indice in range(total):
            if indice % LOTE == 0:
                pedido.andamento(indice / total, f"Página {indice + 1} de {total}")

            saida.insert_pdf(entrada, from_page=indice, to_page=indice)
            if indice in depois_de:
                caixa = entrada[indice].rect
                saida.new_page(width=caixa.width, height=caixa.height)
                inseridas += 1

        destino = pedido.saida or nome_com_sufixo(origem, "com-brancas")
        bytes_saida = salvar(saida, destino, senha)
        paginas = saida.page_count
        saida.close()

        pedido.andamento(1.0)
        return {"arquivo": destino, "paginas": paginas, "inseridas": inseridas, "bytes": bytes_saida}
    finally:
        entrada.close()
