"""Colocar e tirar senha.

As duas ferramentas que mexem só na proteção, sem tocar em nenhuma outra
coisa do documento — diferente das operações que preservam a senha por
tabela, aqui a senha é o próprio pedido.
"""

from __future__ import annotations

from typing import Any, Dict

from ..documento import abrir, nome_com_sufixo, salvar
from ..protocolo import ErroDoUsuario, Pedido


def proteger(pedido: Pedido) -> Dict[str, Any]:
    """Coloca senha num PDF que não tinha, ou troca a que já tinha."""
    if not pedido.arquivos:
        raise ErroDoUsuario("nenhum arquivo escolhido")

    nova_senha = str(pedido.opcao("senha", "")).strip()
    if not nova_senha:
        raise ErroDoUsuario("escreva a senha que o PDF vai usar")

    origem = pedido.arquivos[0]
    doc = abrir(origem, pedido.senha(0))
    try:
        destino = pedido.saida or nome_com_sufixo(origem, "protegido")
        bytes_saida = salvar(doc, destino, nova_senha)

        pedido.andamento(1.0)
        return {
            "arquivo": destino,
            "paginas": doc.page_count,
            "bytes": bytes_saida,
            "notas": ["Guarde essa senha: sem ela, ninguém — nem este aplicativo — consegue abrir o arquivo de novo."],
        }
    finally:
        doc.close()


def desbloquear(pedido: Pedido) -> Dict[str, Any]:
    """Tira a senha, com a senha atual em mãos.

    Não é quebra de senha: precisa da senha certa para entrar, do mesmo jeito
    que abrir o arquivo para qualquer outra operação precisa.
    """
    if not pedido.arquivos:
        raise ErroDoUsuario("nenhum arquivo escolhido")

    origem = pedido.arquivos[0]
    senha_atual = pedido.senha(0)
    if not senha_atual:
        raise ErroDoUsuario("escreva a senha atual do arquivo")

    doc = abrir(origem, senha_atual)
    try:
        destino = pedido.saida or nome_com_sufixo(origem, "sem-senha")
        bytes_saida = salvar(doc, destino, "")

        pedido.andamento(1.0)
        return {"arquivo": destino, "paginas": doc.page_count, "bytes": bytes_saida}
    finally:
        doc.close()
