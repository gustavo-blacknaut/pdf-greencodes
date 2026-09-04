"""Toda acao tem que funcionar sem `saida`, que e como o aplicativo a chama.

Este arquivo existe por causa de um bug que passou por 222 testes verdes.

A marca d'agua guardava o caminho do arquivo numa variavel chamada `origem` e,
dentro do laco, sobrescrevia essa mesma variavel com um Point. Na hora de
salvar, o caminho ja tinha virado coordenada.

Ninguem viu porque a linha do destino e:

    destino = pedido.saida or nome_com_sufixo(origem, "marca-dagua")

Todo teste passava `saida` explicito. O `or` curto-circuitava, o `origem`
estragado nunca era lido, e o teste passava. Mas o adaptador do aplicativo NAO
manda `saida` — ele deixa o motor nomear ao lado da entrada. Ou seja: a
ferramenta estava quebrada para todo mundo, menos para os testes.

Entao aqui a chamada e sem `saida`, de proposito, para todas as acoes de uma
vez. Acao nova entra nesta lista sozinha: o teste varre o registro.
"""

from __future__ import annotations

import os

import pytest

from motor.operacoes import ACOES

# As opcoes minimas para cada acao fazer trabalho de verdade. O que nao esta
# aqui roda com as opcoes padrao.
OPCOES = {
    "extrair": {"paginas": "1-2"},
    "remover": {"paginas": "1"},
    "girar": {"graus": 90},
    "marca-dagua": {"texto": "CONFIDENCIAL"},
    "cabecalho-rodape": {"cabecalho": "Topo", "rodape": "Base"},
    "definir-metadados": {"title": "Titulo"},
    "proteger": {"senha": "1234"},
    "cortar": {"topo": 5, "base": 5},
    "redimensionar": {"papel": "A4"},
    "varias-por-folha": {"porFolha": 2},
    "dividir": {"porArquivo": 2},
    "separar-chapas": {"dpi": 72},
    "cobertura-de-tinta": {"dpi": 72},
    "tons-de-cinza": {"dpi": 72},
    "inverter-cor": {"dpi": 72},
    "tons-de-preto": {"dpi": 72},
    "rgb-para-cmyk": {},
    "pdf-para-imagem": {"dpi": 72},
    "numerar": {},
}

# Acoes que nao recebem PDF, ou que nao geram arquivo: ficam de fora porque
# precisariam de outra entrada, nao porque estao dispensadas da regra.
FORA = {
    "formatos",       # so devolve o catalogo, nao recebe arquivo
    "informar",       # so le e conta
    "ler-metadados",  # so le
    "desenhar",       # recebe uma pagina ja desenhada pela tela
    "imagem-para-pdf",  # entrada e imagem
    "folha-de-fotos",   # entrada e foto
    "desbloquear",    # entrada e um PDF com senha
    "intercalar",     # precisa de dois arquivos
    "juntar",         # precisa de dois arquivos
}

ACOES_QUE_RECEBEM_PDF = sorted(set(ACOES) - FORA)


def _pdf_com_imagem(tmp_path, criar_foto_teste):
    """Um PDF com foto dentro, para quem procura imagem achar alguma."""
    import pymupdf

    foto = criar_foto_teste(largura=200, altura=150)
    doc = pymupdf.open()
    pagina = doc.new_page(width=595, height=842)
    pagina.insert_image(pymupdf.Rect(60, 60, 360, 285), filename=foto)
    caminho = str(tmp_path / "com-imagem.pdf")
    doc.save(caminho)
    doc.close()
    return caminho


@pytest.mark.parametrize("acao", ACOES_QUE_RECEBEM_PDF)
def test_funciona_sem_saida(acao, rodar, criar_pdf, criar_foto_teste, tmp_path):
    """Como o aplicativo chama: sem dizer onde gravar."""
    # Quem procura imagem precisa de um documento que tenha alguma; num PDF
    # so de texto o resultado vazio seria correto e esconderia o que o teste
    # quer ver.
    entrada = (
        _pdf_com_imagem(tmp_path, criar_foto_teste) if acao == "extrair-imagens" else criar_pdf(paginas=4)
    )
    resultado = rodar(acao, [entrada], OPCOES.get(acao, {}))

    # A resposta traz `arquivo` (um) ou `arquivos` (varios). Os dois valem,
    # mas o que vier tem que existir em disco de verdade.
    caminhos = []
    if isinstance(resultado.get("arquivo"), str):
        caminhos.append(resultado["arquivo"])
    for item in resultado.get("arquivos", []) or []:
        caminhos.append(item["arquivo"] if isinstance(item, dict) else item)

    assert caminhos, f"{acao} terminou sem apontar nenhum arquivo"
    for caminho in caminhos:
        assert isinstance(caminho, str), f"{acao} devolveu {type(caminho).__name__} no lugar de um caminho"
        assert os.path.exists(caminho), f"{acao} apontou para {caminho}, que nao existe"
        assert os.path.getsize(caminho) > 0, f"{acao} gravou um arquivo vazio"


def test_a_lista_de_fora_nao_esconde_acao_nova():
    """Acao removida do motor tem que sair da lista de excecoes tambem.

    Sem isto, renomear uma acao deixaria um nome morto em FORA e a acao nova
    entraria no teste sem ninguem perceber que a antiga saiu sem cobertura.
    """
    orfas = FORA - set(ACOES)
    assert not orfas, f"a lista FORA cita acoes que nao existem mais: {sorted(orfas)}"
