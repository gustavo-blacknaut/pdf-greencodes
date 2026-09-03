"""Converter de RGB para CMYK, sem rasterizar nada.

O `recolor` do MuPDF converte a página inteira — texto, vetor e as imagens
embutidas — mantendo tudo como está: o texto continua texto, o traço continua
traço, e o arquivo não incha. Rasterizar era o caminho óbvio e é o errado:
transformaria um contrato de 200 KB numa pilha de imagens de 40 MB.

Sobra um problema, e é o que essa conversão sozinha faz de errado numa
gráfica. O perfil converte preto RGB (0,0,0) para **C72 M67 Y67 K88** — preto
de quadricromia. Numa chapa desalinhada por um fio, texto fino nisso sai com
franja colorida na borda, e área chapada gasta as quatro tintas para fazer o
que uma faz. Por isso, depois de converter, os cinzas e pretos do conteúdo
vetorial voltam para a receita da casa:

- preto puro  → C20 M20 Y0 K100 (o preto rico daqui)
- cinza       → só a chapa preta, K proporcional
- cor de verdade → não se mexe

Foto é diferente e fica como está: o preto de uma foto tem que ter as quatro
tintas para não chapar, e forçar K ali achataria a imagem.
"""

from __future__ import annotations

import re
from typing import Any, Dict, Tuple

import pymupdf

from ..documento import abrir, nome_com_sufixo, salvar
from ..protocolo import ErroDoUsuario, Pedido
from ..tinta import fixar_devicecmyk

# O operador de cor CMYK no conteúdo do PDF: quatro números e `k` (preenche)
# ou `K` (traça).
COR_CMYK = re.compile(rb"(?<![\d.])(\d*\.?\d+)\s+(\d*\.?\d+)\s+(\d*\.?\d+)\s+(\d*\.?\d+)\s+(k|K)(?![A-Za-z])")

# Quanto os três canais podem diferir e ainda contar como neutro. A conversão
# por perfil não devolve C, M e Y idênticos nem para um cinza perfeito — o
# 50% vira C51 M44 Y44 —, então comparar por igualdade não pegaria nada.
TOLERANCIA_NEUTRO = 0.12

# A partir de quanta tinta equivalente um neutro conta como preto puro.
LIMIAR_DE_PRETO = 0.94

# A receita da casa para preto puro, em porcentagem.
PRETO_RICO = (20, 20, 0, 100)
PRETO_K100 = (0, 0, 0, 100)


def tinta_equivalente(c: float, m: float, y: float, k: float) -> float:
    """Quanto escuro um neutro fica, somando o que as quatro chapas fazem.

    Duas camadas de tinta não somam: 50% por cima de 50% não dá 100%, dá 75%,
    porque a segunda só pega no que a primeira deixou passar. É a mesma conta
    de opacidade, e é ela que diz que C51 M44 Y44 K8 é um cinza de 50%.
    """
    return 1 - (1 - (c + m + y) / 3) * (1 - k)


def _formatar(valores: Tuple[float, float, float, float], operador: bytes) -> bytes:
    corpo = b" ".join(b"%g" % round(v, 5) for v in valores)
    return corpo + b" " + operador


def corrigir_neutros(conteudo: bytes, preto: Tuple[int, int, int, int]) -> Tuple[bytes, int]:
    """Devolve o conteúdo com os neutros na receita da casa, e quantos trocou."""
    trocados = 0
    alvo_preto = tuple(v / 100 for v in preto)

    def trocar(achado: re.Match[bytes]) -> bytes:
        nonlocal trocados
        c, m, y, k = (float(achado.group(i)) for i in (1, 2, 3, 4))
        operador = achado.group(5)

        # Cor de verdade não se mexe: só neutro vira chapa preta.
        if max(c, m, y) - min(c, m, y) > TOLERANCIA_NEUTRO:
            return achado.group(0)

        equivalente = tinta_equivalente(c, m, y, k)

        # Branco e quase branco ficam como estão: mexer aqui sujaria o papel.
        if equivalente < 0.01:
            return achado.group(0)

        trocados += 1
        if equivalente >= LIMIAR_DE_PRETO:
            return _formatar(alvo_preto, operador)
        return _formatar((0.0, 0.0, 0.0, equivalente), operador)

    return COR_CMYK.sub(trocar, conteudo), trocados


def rgb_para_cmyk(pedido: Pedido) -> Dict[str, Any]:
    """Passa o documento inteiro para CMYK, preservando texto e vetor."""
    if not pedido.arquivos:
        raise ErroDoUsuario("nenhum arquivo escolhido")

    origem = pedido.arquivos[0]
    senha = pedido.senha(0)

    ajustar_preto = bool(pedido.opcao("ajustarPreto", True))
    preto = PRETO_K100 if str(pedido.opcao("preto", "rico")) == "k100" else PRETO_RICO
    marcar_device = bool(pedido.opcao("marcarDevice", True))

    doc = abrir(origem, senha)
    try:
        if not doc.is_pdf:
            raise ErroDoUsuario("esse arquivo não vira PDF, então não dá para converter a cor")

        total = doc.page_count
        trocas = 0

        for indice in range(total):
            pedido.andamento(indice / total, f"Página {indice + 1} de {total}")
            pagina = doc[indice]

            # Converte texto, vetor e as imagens embutidas de uma vez.
            pagina.recolor(4)

            if not ajustar_preto:
                continue

            # Junta o conteúdo num fluxo só antes de mexer: uma cor pode estar
            # partida entre dois fluxos, e a troca perderia a segunda metade.
            pagina.clean_contents()
            fluxos = pagina.get_contents()
            if not fluxos:
                continue

            xref = fluxos[0]
            corrigido, trocados = corrigir_neutros(doc.xref_stream(xref), preto)
            if trocados:
                doc.update_stream(xref, corrigido)
                trocas += trocados

        # Sem isto o PDF sai com perfil ICC, e perfil é permissão para o RIP
        # converter de novo — justamente o que se queria evitar.
        if marcar_device:
            fixar_devicecmyk(doc)

        destino = pedido.saida or nome_com_sufixo(origem, "cmyk")
        bytes_saida = salvar(doc, destino, senha)

        pedido.andamento(1.0)
        return {
            "arquivo": destino,
            "paginas": total,
            "bytes": bytes_saida,
            "trocasDePreto": trocas,
            "notas": _notas(preto, ajustar_preto, marcar_device, trocas),
        }
    finally:
        doc.close()


def _notas(preto: Tuple[int, int, int, int], ajustou: bool, marcou: bool, trocas: int) -> list[str]:
    notas = ["O texto continua texto e o traço continua traço: nada foi rasterizado."]

    if ajustou:
        receita = f"C{preto[0]} M{preto[1]} Y{preto[2]} K{preto[3]}"
        notas.append(
            f"{trocas} cores neutras foram corrigidas: preto puro saiu em {receita} e os cinzas só na chapa preta. "
            "A conversão por perfil, sozinha, mandaria preto para C72 M67 Y67 K88 — quatro tintas para fazer o que uma faz, "
            "e franja colorida em texto fino se as chapas desalinharem."
        )
    else:
        notas.append(
            "O preto ficou como o perfil converteu, em quatro tintas. Ligue o ajuste de preto para ele sair só na chapa preta."
        )

    if marcou:
        notas.append("Gravado como DeviceCMYK: o RIP recebe esses valores de tinta e não converte de novo.")
    else:
        notas.append("Gravado com o perfil ICC (SWOP). O RIP pode reconverter a cor conforme o perfil dele.")

    notas.append("As fotos ficaram nas quatro tintas, como devem: preto de foto só na chapa preta chaparia a imagem.")
    return notas
