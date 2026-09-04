"""Ler, apagar e escrever título, autor e os outros campos do PDF.

Metadado não aparece na página — vive só nas propriedades do arquivo, o que
o Explorer mostra em "Detalhes". Serve tanto para limpar informação que a
pessoa não queria expor (nome de quem editou, o programa de origem) quanto
para preencher direito antes de mandar para um cliente.
"""

from __future__ import annotations

from typing import Any, Dict

from ..documento import abrir, nome_com_sufixo, salvar
from ..protocolo import ErroDoUsuario, Pedido

CAMPOS = ("title", "author", "subject", "keywords")


def limpar_metadados(pedido: Pedido) -> Dict[str, Any]:
    """Apaga título, autor, assunto e tudo mais — não muda o conteúdo."""
    if not pedido.arquivos:
        raise ErroDoUsuario("nenhum arquivo escolhido")

    origem = pedido.arquivos[0]
    senha = pedido.senha(0)

    doc = abrir(origem, senha)
    try:
        doc.set_metadata({})
        destino = pedido.saida or nome_com_sufixo(origem, "sem-metadados")
        bytes_saida = salvar(doc, destino, senha)

        pedido.andamento(1.0)
        return {"arquivo": destino, "paginas": doc.page_count, "bytes": bytes_saida}
    finally:
        doc.close()


def definir_metadados(pedido: Pedido) -> Dict[str, Any]:
    """Escreve título, autor, assunto e palavras-chave — o que vier em branco apaga o campo."""
    if not pedido.arquivos:
        raise ErroDoUsuario("nenhum arquivo escolhido")

    origem = pedido.arquivos[0]
    senha = pedido.senha(0)

    doc = abrir(origem, senha)
    try:
        atual = dict(doc.metadata or {})
        for campo in CAMPOS:
            atual[campo] = str(pedido.opcao(campo, atual.get(campo, "")))
        doc.set_metadata(atual)

        destino = pedido.saida or nome_com_sufixo(origem, "com-metadados")
        bytes_saida = salvar(doc, destino, senha)

        pedido.andamento(1.0)
        return {"arquivo": destino, "paginas": doc.page_count, "bytes": bytes_saida}
    finally:
        doc.close()


def ler_metadados(pedido: Pedido) -> Dict[str, Any]:
    """O que o arquivo tem hoje, para a tela pré-preencher os campos."""
    if not pedido.arquivos:
        raise ErroDoUsuario("nenhum arquivo escolhido")

    doc = abrir(pedido.arquivos[0], pedido.senha(0))
    try:
        atual = dict(doc.metadata or {})
        return {campo: atual.get(campo, "") for campo in CAMPOS}
    finally:
        doc.close()
