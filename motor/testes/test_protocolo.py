"""O canal de linhas JSON entre o aplicativo e o motor."""

from __future__ import annotations

import io
import json
import sys

from motor.protocolo import ErroDoUsuario, Pedido, atender


def conversar(linhas, acoes):
    """Roda o motor com uma entrada de mentira e devolve o que ele respondeu."""
    escrito = io.StringIO()
    antigo = sys.stdout
    sys.stdout = escrito
    try:
        atender(iter(linhas), acoes)
    finally:
        sys.stdout = antigo
    return [json.loads(linha) for linha in escrito.getvalue().splitlines() if linha.strip()]


class TestAtender:
    def test_responde_com_o_mesmo_id(self):
        respostas = conversar(['{"id":"7","acao":"eco"}'], {"eco": lambda p: {"ok": True}})
        assert respostas[0]["id"] == "7"
        assert respostas[0]["tipo"] == "fim"

    def test_linha_em_branco_e_ignorada(self):
        respostas = conversar(["", "  ", '{"id":"1","acao":"eco"}'], {"eco": lambda p: {}})
        assert len(respostas) == 1

    def test_json_quebrado_vira_erro_e_nao_derruba(self):
        respostas = conversar(["nao e json", '{"id":"2","acao":"eco"}'], {"eco": lambda p: {}})
        assert respostas[0]["tipo"] == "erro"
        assert respostas[1]["tipo"] == "fim", "o motor devia continuar atendendo depois do erro"

    def test_acao_desconhecida_diz_o_nome(self):
        respostas = conversar(['{"id":"1","acao":"voar"}'], {})
        assert "voar" in respostas[0]["erro"]

    def test_erro_do_usuario_sai_sem_traceback(self):
        def recusar(pedido):
            raise ErroDoUsuario("a senha nao confere")

        resposta = conversar(['{"id":"1","acao":"x"}'], {"x": recusar})[0]
        assert resposta["erro"] == "a senha nao confere"
        assert "detalhe" not in resposta, "erro do usuario nao devia carregar traceback"

    def test_erro_inesperado_carrega_o_detalhe(self):
        def quebrar(pedido):
            raise ValueError("algo interno")

        resposta = conversar(['{"id":"1","acao":"x"}'], {"x": quebrar})[0]
        assert resposta["classe"] == "ValueError"
        assert "detalhe" in resposta

    def test_um_trabalho_ruim_nao_impede_o_proximo(self):
        def quebrar(pedido):
            raise ValueError("ruim")

        respostas = conversar(
            ['{"id":"1","acao":"ruim"}', '{"id":"2","acao":"bom"}'],
            {"ruim": quebrar, "bom": lambda p: {"valor": 42}},
        )
        assert respostas[0]["tipo"] == "erro"
        assert respostas[1]["dados"]["valor"] == 42

    def test_encerrar_para_de_ler(self):
        respostas = conversar(
            ['{"id":"1","acao":"encerrar"}', '{"id":"2","acao":"eco"}'],
            {"eco": lambda p: {"nao": "devia chegar aqui"}},
        )
        assert len(respostas) == 1


class TestPedido:
    def escrever_em(self, lista):
        return lista.append

    def test_senha_por_arquivo(self):
        pedido = Pedido({"senhas": ["a", "b"]}, self.escrever_em([]))
        assert pedido.senha(0) == "a"
        assert pedido.senha(1) == "b"

    def test_uma_senha_so_vale_para_todos(self):
        pedido = Pedido({"senhas": ["unica"]}, self.escrever_em([]))
        assert pedido.senha(3) == "unica"

    def test_sem_senha_devolve_vazio(self):
        assert Pedido({}, self.escrever_em([])).senha(0) == ""

    def test_andamento_silencia_passo_pequeno(self):
        """Mil paginas gerariam mil linhas de ruido, e a barra na tela nem
        consegue mostrar essa diferenca."""
        registradas = []
        pedido = Pedido({"id": "1"}, registradas.append)

        for i in range(1000):
            pedido.andamento(i / 1000)

        assert len(registradas) < 250

    def test_andamento_sempre_deixa_passar_o_fim(self):
        registradas = []
        pedido = Pedido({"id": "1"}, registradas.append)
        pedido.andamento(0.999)
        pedido.andamento(1.0)
        assert registradas[-1]["fracao"] == 1.0

    def test_andamento_nao_sai_da_faixa(self):
        registradas = []
        pedido = Pedido({"id": "1"}, registradas.append)
        pedido.andamento(-5)
        pedido.andamento(99)
        assert [r["fracao"] for r in registradas] == [0.0, 1.0]
