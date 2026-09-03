"""Tons de cinza, inverter cor e tons de preto.

As tres redesenham a pagina e transformam os pixels. Redesenhar descarta o
texto vetorial, entao o resultado deixa de ser pesquisavel; e o preco de
garantir que a cor no papel seja a que aparece na tela, porque mexer na cor sem
redesenhar exigiria reinterpretar cada objeto do PDF e ainda assim nao pegaria
o que esta dentro de imagem.

Nenhuma delas percorre pixel a pixel em Python. Uma pagina A4 a 150 DPI tem
2,2 milhoes de pixels, e um laco desses em Python levaria alguns segundos por
pagina: jogaria fora exatamente o ganho que trouxe o PyMuPDF para o projeto. O
cinza sai do proprio MuPDF, a inversao sai de `invert_irect` em C, e o limiar
sai de uma tabela de traducao de 256 bytes aplicada por `bytes.translate`, que
tambem e C.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Any, Callable, Dict, List

import pymupdf

from ..documento import abrir, nome_com_sufixo, salvar
from ..tinta import TINTAS, cmyk_do_cinza, fixar_devicecmyk
from ..protocolo import ErroDoUsuario, Pedido

DPI_PADRAO = 150
DPI_MINIMO = 72
DPI_MAXIMO = 300

LIMITE_PADRAO = 180
LIMITE_MINIMO = 60
LIMITE_MAXIMO = 240


def em_cinza(pixels: pymupdf.Pixmap) -> pymupdf.Pixmap:
    """Deixa a pagina em um canal so, com o peso perceptual do MuPDF.

    A conversao do MuPDF ja usa luminancia, entao verde pesa mais que vermelho,
    que pesa mais que azul. Uma media simples dos tres deixaria texto azul
    quase invisivel no papel.
    """
    if pixels.colorspace is not None and pixels.colorspace.n == 1:
        return pixels
    return pymupdf.Pixmap(pymupdf.csGRAY, pixels)


def inverter(pixels: pymupdf.Pixmap) -> pymupdf.Pixmap:
    """Negativo em preto e branco.

    Passa por cinza primeiro de proposito. Inverter os tres canais de um
    documento colorido devolveria as cores complementares (vermelho vira
    ciano), que e outra coisa e quase nunca e o que se quer: o uso real e ler
    documento de fundo escuro e economizar toner num que veio todo preto.
    """
    cinza = em_cinza(pixels)
    cinza.invert_irect(cinza.irect)
    return cinza


@lru_cache(maxsize=8)
def tabela_de_corte(corte: int) -> bytes:
    """De que tom cada tom vira: tudo acima do corte vai a branco, o resto a preto.

    Sao 256 bytes, um por tom possivel, e o mesmo corte costuma se repetir em
    todas as paginas do documento — por isso a tabela fica guardada.
    """
    return bytes(255 if tom > corte else 0 for tom in range(256))


def limiar(pixels: pymupdf.Pixmap, corte: int) -> pymupdf.Pixmap:
    """Sem meio-termo: abaixo do corte vira preto puro, acima vira branco.

    Cinza claro de digitalizacao imprime falhado, e texto digitalizado costuma
    sair acinzentado. Foto neste modo vira mancha, porque nao sobra meio-tom.

    A troca acontece em `bytes.translate`, que percorre os 2,2 milhoes de
    pixels em C. Chegar aqui com um canal so e o que permite isso: em RGB
    seriam tres bytes por pixel e a tabela nao daria conta.
    """
    cinza = em_cinza(pixels)
    duros = cinza.samples.translate(tabela_de_corte(corte))
    return pymupdf.Pixmap(pymupdf.csGRAY, cinza.width, cinza.height, duros, False)


def _redesenhar(
    pedido: Pedido,
    transformar: Callable[[pymupdf.Pixmap], pymupdf.Pixmap],
    sufixo: str,
    notas: List[str],
    cmyk: bool = False,
) -> Dict[str, Any]:
    """A maquina que as tres operacoes compartilham."""
    if not pedido.arquivos:
        raise ErroDoUsuario("nenhum arquivo escolhido")

    dpi = max(DPI_MINIMO, min(DPI_MAXIMO, int(pedido.opcao("dpi", DPI_PADRAO))))
    origem = pedido.arquivos[0]
    senha = pedido.senha(0)

    entrada = abrir(origem, senha)
    saida = pymupdf.open()
    try:
        total = entrada.page_count
        for indice in range(total):
            pedido.andamento(indice / total, f"Pagina {indice + 1} de {total}")

            pagina = entrada[indice]
            pixels = transformar(pagina.get_pixmap(dpi=dpi))

            nova = saida.new_page(width=pagina.rect.width, height=pagina.rect.height)
            nova.insert_image(nova.rect, pixmap=pixels)

            # Solta o mapa de pixels antes da proxima pagina: uma A3 a 300 DPI
            # ocupa uns 50 MB, e segurar duas ja aperta numa maquina de 4 GB.
            del pixels

        # O ColorSpace so pode ser trocado depois que as imagens existem, e
        # tem que ser antes de salvar.
        if cmyk:
            fixar_devicecmyk(saida)

        destino = pedido.saida or nome_com_sufixo(origem, sufixo)
        bytes_saida = salvar(saida, destino, senha)

        pedido.andamento(1.0)
        return {"arquivo": destino, "paginas": total, "bytes": bytes_saida, "notas": notas}
    finally:
        saida.close()
        entrada.close()


def tons_de_cinza(pedido: Pedido) -> Dict[str, Any]:
    return _redesenhar(
        pedido,
        em_cinza,
        "cinza",
        [
            "O documento virou preto e branco com meio-tom, que e o modo certo para foto.",
            "As paginas viraram imagem, entao o texto deixa de ser selecionavel.",
        ],
    )


def inverter_cor(pedido: Pedido) -> Dict[str, Any]:
    return _redesenhar(
        pedido,
        inverter,
        "invertido",
        [
            "O que era escuro ficou claro e o que era claro ficou escuro.",
            "As paginas viraram imagem, entao o texto deixa de ser selecionavel.",
        ],
    )


def tons_de_preto(pedido: Pedido) -> Dict[str, Any]:
    """Tudo abaixo do corte vira preto; acima, papel.

    A tinta decide em qual chapa esse preto sai. `rgb` serve para laser e para
    ler na tela. `k100` e `rico` gravam DeviceCMYK de verdade, e existem porque
    numa grafica preto nao e uma cor so: ver o modulo `tinta`.
    """
    corte = max(LIMITE_MINIMO, min(LIMITE_MAXIMO, int(pedido.opcao("limite", LIMITE_PADRAO))))
    tinta = str(pedido.opcao("tinta", "rgb"))

    comum = [
        "Cinza virou preto puro e o fundo virou branco.",
        "Nao ha meio-tom: foto neste modo vira mancha. Para foto, use tons de cinza.",
    ]

    if tinta not in TINTAS:
        return _redesenhar(pedido, lambda pixels: limiar(pixels, corte), "preto", comum)

    escolhida = TINTAS[tinta]
    c, m, y, k = escolhida["cmyk"]

    return _redesenhar(
        pedido,
        lambda pixels: cmyk_do_cinza(em_cinza(pixels), corte, (c, m, y, k)),
        f"preto-{tinta}",
        [
            f"O preto saiu em {escolhida['nome']}, gravado como DeviceCMYK.",
            escolhida["nota"],
            "Sem perfil ICC no meio, entao o RIP recebe exatamente estes valores de tinta.",
            *comum,
        ],
        cmyk=True,
    )
