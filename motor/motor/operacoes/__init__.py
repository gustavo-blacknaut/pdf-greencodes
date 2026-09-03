"""Registro das acoes que o motor atende.

Uma acao e uma funcao que recebe o Pedido e devolve um dicionario. O nome que
aparece aqui e o que o aplicativo manda no campo "acao": mudar este mapa e a
unica coisa necessaria para ligar ou desligar uma ferramenta.
"""

from .converter import extrair_imagens, imagem_para_pdf, pdf_para_imagem
from .cores import inverter_cor, tons_de_cinza, tons_de_preto
from .desenhar import desenhar
from .fotos import folha_de_fotos, formatos
from .informar import informar
from .marcar import cabecalho_rodape, marca_dagua, numerar
from .metadados import definir_metadados, ler_metadados, limpar_metadados
from .organizar import (
    dividir,
    extrair,
    girar,
    intercalar,
    inverter_paginas,
    juntar,
    paginas_em_branco,
    remover,
    separar_pares_impares,
)
from .otimizar import comprimir, reparar
from .pagina import cortar, dividir_paginas, livreto, redimensionar, varias_por_folha
from .seguranca import desbloquear, proteger

ACOES = {
    "informar": informar,
    "formatos": formatos,
    "folha-de-fotos": folha_de_fotos,
    "desenhar": desenhar,
    "comprimir": comprimir,
    "reparar": reparar,
    "juntar": juntar,
    "dividir": dividir,
    "extrair": extrair,
    "remover": remover,
    "girar": girar,
    "tons-de-cinza": tons_de_cinza,
    "inverter-cor": inverter_cor,
    "tons-de-preto": tons_de_preto,
    "varias-por-folha": varias_por_folha,
    "livreto": livreto,
    "dividir-paginas": dividir_paginas,
    "cortar": cortar,
    "redimensionar": redimensionar,
    "numerar": numerar,
    "marca-dagua": marca_dagua,
    "cabecalho-rodape": cabecalho_rodape,
    "pdf-para-imagem": pdf_para_imagem,
    "imagem-para-pdf": imagem_para_pdf,
    "extrair-imagens": extrair_imagens,
    "proteger": proteger,
    "desbloquear": desbloquear,
    "limpar-metadados": limpar_metadados,
    "definir-metadados": definir_metadados,
    "ler-metadados": ler_metadados,
    "inverter-paginas": inverter_paginas,
    "intercalar": intercalar,
    "separar-pares-impares": separar_pares_impares,
    "paginas-em-branco": paginas_em_branco,
}

__all__ = ["ACOES"]
