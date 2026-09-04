"""Abrir e salvar PDF, incluindo os que vem com senha.

Tudo que mexe em documento passa por aqui, para que a regra da senha exista em
um lugar so. No projeto anterior a senha se perdia no comprimir porque cada
operacao salvava do seu jeito, e o arquivo saia aberto sem ninguem avisar.
"""

from __future__ import annotations

import os
import unicodedata
from typing import Iterator

import pymupdf

from .protocolo import ErroDoUsuario, Pedido


def variantes(senha: str) -> list[str]:
    """As formas em que a mesma senha pode ter sido gravada.

    Acento em Windows costuma vir decomposto (NFD) e no PDF composto (NFC), ou
    o contrario; e senha colada de um e-mail vem com espaco no fim. Sao quatro
    tentativas locais, nao forca bruta: se nenhuma abrir, a senha esta errada
    mesmo.
    """
    if not senha:
        return [""]

    bases = [senha, senha.strip()]
    todas = []
    for base in bases:
        for forma in (base, unicodedata.normalize("NFC", base), unicodedata.normalize("NFD", base)):
            if forma not in todas:
                todas.append(forma)
    return todas


def abrir(caminho: str, senha: str = "") -> pymupdf.Document:
    """Abre o arquivo como PDF, destrancando e convertendo se precisar.

    Imagem entra como PDF de uma pagina. O MuPDF abre JPG e PNG como
    documento, mas o que sai dali nao e um PDF de verdade: `show_pdf_page`
    recusa com "is no PDF", e era esse o erro que redimensionar, livreto e
    varias-por-folha davam quando recebiam uma foto. Converter aqui resolve
    para todas as operacoes de uma vez, em vez de cada uma se defender.

    Devolve o documento ainda com a criptografia original registrada, para que
    `salvar` saiba que tem senha a preservar.
    """
    if not os.path.exists(caminho):
        raise ErroDoUsuario(f"nao encontrei o arquivo: {os.path.basename(caminho)}")

    try:
        doc = pymupdf.open(caminho)
    except Exception as erro:  # noqa: BLE001
        raise ErroDoUsuario(f"nao consegui ler {os.path.basename(caminho)}: {erro}") from erro

    if not doc.is_pdf:
        try:
            convertido = pymupdf.open("pdf", doc.convert_to_pdf())
        except Exception as erro:  # noqa: BLE001
            doc.close()
            raise ErroDoUsuario(
                f"{os.path.basename(caminho)} nao e PDF e nao consegui converter: {erro}"
            ) from erro
        doc.close()
        return convertido

    if not doc.needs_pass:
        return doc

    for tentativa in variantes(senha):
        if doc.authenticate(tentativa):
            return doc

    doc.close()
    if senha:
        raise ErroDoUsuario(f"a senha de {os.path.basename(caminho)} nao confere")
    raise ErroDoUsuario(f"{os.path.basename(caminho)} esta protegido por senha")


def abrir_todos(pedido: Pedido) -> Iterator[pymupdf.Document]:
    """Os arquivos do pedido, cada um com a sua senha."""
    for indice, caminho in enumerate(pedido.arquivos):
        yield abrir(caminho, pedido.senha(indice))


def salvar(doc: pymupdf.Document, destino: str, senha: str = "", comprimir: bool = True) -> int:
    """Grava o PDF e devolve o tamanho em bytes.

    Se o documento entrou com senha, sai com a mesma senha. Perder a protecao
    numa operacao que o usuario pediu por outro motivo e mudanca silenciosa
    de seguranca, e nao cabe ao programa decidir isso sozinho.
    """
    os.makedirs(os.path.dirname(os.path.abspath(destino)) or ".", exist_ok=True)

    opcoes = {
        "garbage": 4 if comprimir else 0,
        "deflate": True,
        "deflate_images": comprimir,
        "deflate_fonts": comprimir,
        "clean": comprimir,
    }

    if senha:
        opcoes.update(
            {
                "encryption": pymupdf.PDF_ENCRYPT_AES_256,
                "owner_pw": senha,
                "user_pw": senha,
                "permissions": pymupdf.PDF_PERM_ACCESSIBILITY | pymupdf.PDF_PERM_PRINT | pymupdf.PDF_PERM_COPY,
            }
        )

    doc.save(destino, **opcoes)
    return os.path.getsize(destino)


def nome_com_sufixo(caminho: str, sufixo: str, extensao: str = "") -> str:
    """`contrato.pdf` + `comprimido` vira `contrato-comprimido.pdf`."""
    pasta, arquivo = os.path.split(caminho)
    base, ext = os.path.splitext(arquivo)
    return os.path.join(pasta, f"{base}-{sufixo}{extensao or ext}")


def faixa_de_paginas(texto: str, total: int) -> list[int]:
    """Le "1-3, 7, 10-" e devolve indices comecando do zero.

    Vazio quer dizer o documento inteiro. Numero fora do documento e ignorado
    em vez de virar erro: quem digita "1-999" querendo tudo esta sendo claro o
    bastante.
    """
    texto = (texto or "").strip()
    if not texto:
        return list(range(total))

    escolhidas: list[int] = []
    for parte in texto.replace(";", ",").split(","):
        parte = parte.strip()
        if not parte:
            continue

        if "-" in parte:
            comeco, _, fim = parte.partition("-")
            try:
                primeira = int(comeco) if comeco.strip() else 1
                ultima = int(fim) if fim.strip() else total
            except ValueError as erro:
                raise ErroDoUsuario(f"nao entendi o intervalo de paginas: {parte}") from erro
        else:
            try:
                primeira = ultima = int(parte)
            except ValueError as erro:
                raise ErroDoUsuario(f"nao entendi a pagina: {parte}") from erro

        if primeira > ultima:
            primeira, ultima = ultima, primeira

        for numero in range(primeira, ultima + 1):
            indice = numero - 1
            if 0 <= indice < total and indice not in escolhidas:
                escolhidas.append(indice)

    if not escolhidas:
        raise ErroDoUsuario("nenhuma das paginas pedidas existe no documento")
    return escolhidas
