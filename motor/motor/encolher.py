"""Fazer um PDF caber num tamanho, tirando o menos possivel.

Nasceu de um caso concreto: dividindo um documento com limite de 1 MB por
parte, algumas partes saiam com 3,9 MB. Nao era defeito da divisao — uma
pagina sozinha nao tem como ser dividida de novo. Para caber, ela precisa
encolher.

A ordem das tentativas e o que importa aqui, e ela vai do que nao custa nada
para o que custa:

1. **Arrumar a estrutura.** Deduplicar objetos repetidos, jogar fora o que
   ninguem referencia, recomprimir os fluxos. Nao mexe em um pixel sequer: o
   resultado e identico ao original, so que menor. Muitas vezes ja resolve.

2. **Reduzir as imagens embutidas.** So as imagens; o texto continua texto,
   selecionavel e pesquisavel. E o que o pessoal chama de "comprimir PDF sem
   estragar" e o que a maioria dos servicos online faz.

O que este arquivo **nao** faz e redesenhar a pagina inteira como foto. Isso
corta muito mais, mas destroi o texto — e virou o padrao de tanta ferramenta
que a pessoa acha normal receber de volta um documento que nao da mais para
copiar. Aqui isso e outra ferramenta, pedida de proposito.
"""

from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

import pymupdf

from .documento import salvar

# A escada de tentativas, da mais conservadora para a mais agressiva.
#
# O `rewrite_images` do MuPDF reduz por metades — uma imagem de 2480 px vai
# para 1240 e depois para 620 —, entao degraus vizinhos as vezes dao o mesmo
# arquivo. Nao ha desperdicio real: a primeira que couber encerra a busca, e
# medir e barato perto de gravar.
#
# 200 DPI ainda imprime bem em laser; 150 e leitura de tela confortavel; 96 e
# o limite em que texto dentro de imagem ainda se le; abaixo disso e para o
# caso de "precisa caber, custe o que custar".
DEGRAUS = [
    {"dpi": 200, "qualidade": 88, "conta": "imagens acima de 200 DPI reduzidas"},
    {"dpi": 150, "qualidade": 82, "conta": "imagens reduzidas para 150 DPI"},
    {"dpi": 120, "qualidade": 75, "conta": "imagens reduzidas para 120 DPI"},
    {"dpi": 96, "qualidade": 68, "conta": "imagens reduzidas para 96 DPI"},
    {"dpi": 72, "qualidade": 60, "conta": "imagens reduzidas para 72 DPI, o limite do que ainda se le"},
    {"dpi": 50, "qualidade": 45, "conta": "imagens reduzidas ao minimo"},
]


class Resultado:
    """O que aconteceu com um arquivo, para a nota poder contar a verdade."""

    def __init__(self, bytes_saida: int, coube: bool, conta: str, sem_perda: bool):
        self.bytes = bytes_saida
        self.coube = coube
        self.conta = conta
        self.sem_perda = sem_perda


def apenas_arrumando(
    origem: str,
    destino: str,
    senha: str = "",
) -> int:
    """Grava de novo sem tocar em imagem nenhuma. Devolve o tamanho.

    E o passo que nunca custa qualidade. `salvar` ja liga a deduplicacao e a
    recompressao, entao aqui basta abrir e gravar.

    O arquivo e lido para a memoria antes de abrir, e nao aberto pelo caminho.
    A diferenca aparece quando `destino` e o proprio `origem` — que e como o
    dividir chama, encolhendo a parte por cima dela mesma: aberto pelo
    caminho, o MuPDF recusa gravar no arquivo de onde esta lendo.
    """
    with open(origem, "rb") as arquivo:
        conteudo = arquivo.read()

    doc = pymupdf.open(stream=conteudo, filetype="pdf")
    try:
        if senha:
            doc.authenticate(senha)
        return salvar(doc, destino, senha)
    finally:
        doc.close()


def ate_caber(
    origem: str,
    destino: str,
    limite_bytes: int,
    senha: str = "",
    degraus: Optional[List[Dict[str, Any]]] = None,
    andamento=None,
) -> Resultado:
    """Encolhe ate caber no limite, tirando o menos possivel.

    `origem` e `destino` podem ser o mesmo caminho: cada tentativa reabre o
    arquivo de origem, entao o destino so e escrito no fim de cada rodada.
    Isso importa porque o `rewrite_images` altera o documento no lugar, e
    tentar o degrau seguinte em cima do anterior encolheria duas vezes.
    """
    degraus = DEGRAUS if degraus is None else degraus

    # Passo 1: so arrumar. Sem perder nada.
    tamanho = apenas_arrumando(origem, destino, senha)
    if tamanho <= limite_bytes:
        return Resultado(tamanho, True, "arrumando a estrutura, sem tocar nas imagens", True)

    # Guarda o original: as tentativas seguintes todas partem dele, e o
    # destino pode ser o proprio arquivo de origem.
    with open(origem, "rb") as arquivo:
        original = arquivo.read()

    melhor = tamanho
    melhor_conta = "arrumando a estrutura, sem tocar nas imagens"

    for indice, degrau in enumerate(degraus):
        if andamento:
            andamento(indice / len(degraus), f"Tentando caber em {limite_bytes // 1024} KB")

        doc = pymupdf.open(stream=original, filetype="pdf")
        try:
            if senha:
                doc.authenticate(senha)
            # `dpi_threshold` tem que ser maior que `dpi_target`: ele diz a
            # partir de qual resolucao vale mexer na imagem.
            doc.rewrite_images(
                dpi_threshold=degrau["dpi"] + 1,
                dpi_target=degrau["dpi"],
                quality=degrau["qualidade"],
            )
            tamanho = salvar(doc, destino, senha)
        finally:
            doc.close()

        melhor = tamanho
        melhor_conta = degrau["conta"]
        if tamanho <= limite_bytes:
            return Resultado(tamanho, True, degrau["conta"], False)

    # Nao coube nem no degrau mais baixo. O arquivo gravado e o menor que se
    # conseguiu, e quem chamou avisa que passou.
    return Resultado(melhor, False, melhor_conta, False)
