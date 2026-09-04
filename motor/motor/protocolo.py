"""Conversa com o aplicativo.

Uma linha de JSON entra pelo stdin, uma ou mais saem pelo stdout. Escolhi
linha em vez de um servidor HTTP porque o motor morre junto com o aplicativo,
sem porta aberta na maquina e sem ninguem de fora conseguindo falar com ele.

Formato do pedido:

    {"id": "7", "acao": "informar", "arquivos": ["a.pdf"], "opcoes": {}}

Formato da resposta, sempre com o mesmo id:

    {"id": "7", "tipo": "andamento", "fracao": 0.5, "mensagem": "Pagina 3 de 6"}
    {"id": "7", "tipo": "fim", "dados": {...}}
    {"id": "7", "tipo": "erro", "erro": "senha errada", "classe": "SenhaErrada"}
"""

from __future__ import annotations

import json
import sys
import traceback
from typing import Any, Callable, Dict, Iterable


class Pedido:
    """Um trabalho pedido pelo aplicativo, com o canal de volta."""

    def __init__(self, bruto: Dict[str, Any], escrever: Callable[[Dict[str, Any]], None]):
        self.id: str = str(bruto.get("id", ""))
        self.acao: str = bruto.get("acao", "")
        self.arquivos: list[str] = list(bruto.get("arquivos", []))
        self.opcoes: Dict[str, Any] = dict(bruto.get("opcoes", {}))
        self.senhas: list[str] = list(bruto.get("senhas", []))
        self.saida: str = bruto.get("saida", "")
        self._escrever = escrever
        self._ultima = -1.0

    def senha(self, indice: int = 0) -> str:
        """A senha do arquivo na posicao pedida, ou a primeira, ou nada.

        O aplicativo manda uma senha por arquivo quando sabe; quando o usuario
        digitou uma senha so, ela vale para todos.
        """
        if indice < len(self.senhas):
            return self.senhas[indice]
        return self.senhas[0] if self.senhas else ""

    def opcao(self, chave: str, padrao: Any = None) -> Any:
        return self.opcoes.get(chave, padrao)

    def andamento(self, fracao: float, mensagem: str = "") -> None:
        """Avisa o aplicativo do progresso.

        Silencia passos menores que meio por cento: um documento de mil paginas
        geraria mil linhas de ruido, e a barra na tela nem consegue mostrar
        essa diferenca.
        """
        fracao = max(0.0, min(1.0, float(fracao)))
        if fracao < 1.0 and fracao - self._ultima < 0.005:
            return
        self._ultima = fracao
        self._escrever({"id": self.id, "tipo": "andamento", "fracao": fracao, "mensagem": mensagem})


class ErroDoUsuario(Exception):
    """Problema que o usuario consegue resolver, e que merece texto claro.

    Separado das outras excecoes porque um traceback de Python na tela nao
    ajuda ninguem a descobrir que o PDF esta com senha.
    """


def _escrever(linha: Dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(linha, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def atender(entrada: Iterable[str], acoes: Dict[str, Callable[[Pedido], Dict[str, Any]]]) -> None:
    """Le pedidos ate a entrada acabar e responde um por um.

    Sequencial de proposito. Paralelizar aqui competiria por memoria justo nas
    maquinas fracas que o aplicativo precisa atender; quem quiser dois
    trabalhos ao mesmo tempo abre dois motores.
    """
    for linha in entrada:
        linha = linha.strip()
        if not linha:
            continue

        try:
            bruto = json.loads(linha)
        except json.JSONDecodeError as erro:
            _escrever({"id": "", "tipo": "erro", "erro": f"JSON invalido: {erro}", "classe": "JSONDecodeError"})
            continue

        pedido = Pedido(bruto, _escrever)

        if pedido.acao == "encerrar":
            _escrever({"id": pedido.id, "tipo": "fim", "dados": {}})
            return

        acao = acoes.get(pedido.acao)
        if acao is None:
            _escrever({"id": pedido.id, "tipo": "erro", "erro": f"acao desconhecida: {pedido.acao}", "classe": "AcaoDesconhecida"})
            continue

        try:
            dados = acao(pedido)
            _escrever({"id": pedido.id, "tipo": "fim", "dados": dados})
        except ErroDoUsuario as erro:
            _escrever({"id": pedido.id, "tipo": "erro", "erro": str(erro), "classe": "ErroDoUsuario"})
        except Exception as erro:  # noqa: BLE001 - o motor nao pode cair por causa de um arquivo ruim
            _escrever(
                {
                    "id": pedido.id,
                    "tipo": "erro",
                    "erro": str(erro) or erro.__class__.__name__,
                    "classe": erro.__class__.__name__,
                    "detalhe": traceback.format_exc(limit=4),
                }
            )
