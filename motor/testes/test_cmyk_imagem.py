"""Foto em RGB tem que sair foto em CMYK.

Este arquivo nasceu de uma tela: uma imagem convertida para CMYK abria com o
icone de arquivo quebrado do Windows. A causa era pior que um erro — nao
havia erro nenhum.

O MuPDF abre JPG e PNG como documento, e o `abrir` do projeto converte isso
para PDF de uma pagina, de proposito, para as outras ferramentas nao
recusarem foto. A conversao de cor entao rodava em cima desse PDF e, no fim,
`salvar` gravava um **PDF com o nome que a pessoa escolheu** — que ainda
terminava em `.png`. O Windows via a extensao, tentava abrir como imagem, e
mostrava o icone quebrado. Nenhuma excecao, nenhuma nota, arquivo entregue.

Ha ainda um detalhe que nao e do programa e sim do formato: **PNG nao guarda
CMYK**. Nao tem esse tipo de cor. O proprio MuPDF recusa com "unsupported
colorspace for 'png'". Entregar `.png` numa conversao para CMYK e prometer o
impossivel, e por isso a saida sai em JPG ou PSD.
"""

from __future__ import annotations

import os

import pymupdf
import pytest

from motor.operacoes.cmyk import FORMATOS_CMYK, rgb_para_cmyk
from motor.protocolo import Pedido

# As cores puras e o que elas viram nas quatro tintas. Os valores sao os que a
# conversao devolve; o que se trava aqui e que **cada uma vira a sua**, e nao
# que so o preto muda.
CORES = [
    ("vermelho", (1, 0, 0), (0, 100, 100)),
    ("verde", (0, 1, 0), (62, 0, 100)),
    ("azul", (0, 0, 1), (88, 77, 0)),
]


def _pedido(caminho, saida, **opcoes):
    return Pedido(
        {
            "id": "1",
            "acao": "rgb-para-cmyk",
            "arquivos": [str(caminho)],
            "opcoes": opcoes,
            "saida": str(saida),
        },
        lambda _linha: None,
    )


@pytest.fixture()
def imagem_rgb(tmp_path):
    """Tres faixas de cor pura, para conferir cor por cor depois."""
    doc = pymupdf.open()
    pagina = doc.new_page(width=300, height=200)
    for indice, (_nome, cor, _esperado) in enumerate(CORES):
        pagina.draw_rect(pymupdf.Rect(indice * 100, 0, (indice + 1) * 100, 200), color=None, fill=cor)
    caminho = tmp_path / "1.png"
    pagina.get_pixmap(dpi=100).save(str(caminho))
    doc.close()
    return caminho


def test_a_saida_e_imagem_de_verdade(imagem_rgb, tmp_path):
    """O defeito relatado: saia um PDF com nome .png, e nada abria."""
    resposta = rgb_para_cmyk(_pedido(imagem_rgb, tmp_path / "saida.png"))
    saida = resposta["arquivo"]

    with open(saida, "rb") as arquivo:
        cabeca = arquivo.read(4)

    assert cabeca[:4] != b"%PDF", "voltou a gravar um PDF com nome de imagem"
    assert cabeca[:2] == b"\xff\xd8", "nao e um JPEG"


def test_a_extensao_acompanha_o_formato(imagem_rgb, tmp_path):
    """Pedir .png e receber .png com PDF dentro foi o erro. Agora o nome muda."""
    resposta = rgb_para_cmyk(_pedido(imagem_rgb, tmp_path / "saida.png"))
    assert resposta["arquivo"].lower().endswith(".jpg")
    assert os.path.exists(resposta["arquivo"])


def test_todas_as_cores_viram_cmyk_e_nao_so_o_preto(imagem_rgb, tmp_path):
    """A pergunta que motivou tudo: ele muda so o preto?

    Nao. Cada cor vira a sua equivalente nas quatro tintas, e este teste
    confere uma por uma.
    """
    resposta = rgb_para_cmyk(_pedido(imagem_rgb, tmp_path / "saida.jpg"))
    pixels = pymupdf.Pixmap(resposta["arquivo"])

    assert pixels.n == 4, "a imagem nao saiu em quatro canais"

    for indice, (nome, _cor, esperado) in enumerate(CORES):
        x = int((indice * 100 + 50) / 300 * pixels.width)
        c, m, y, _k = pixels.pixel(x, pixels.height // 2)
        medido = (round(c / 255 * 100), round(m / 255 * 100), round(y / 255 * 100))
        for canal, (obtido, alvo) in enumerate(zip(medido, esperado)):
            assert abs(obtido - alvo) <= 3, f"{nome}: canal {canal} deu {obtido}, esperado perto de {alvo}"


def test_o_jpeg_tem_o_marcador_que_o_rip_procura(imagem_rgb, tmp_path):
    """CMYK em JPEG so e reconhecido com o marcador APP14 da Adobe.

    Sem ele, muito leitor assume que os quatro componentes sao YCCK ou trata
    como RGB, e a cor sai invertida na hora de imprimir.
    """
    resposta = rgb_para_cmyk(_pedido(imagem_rgb, tmp_path / "saida.jpg"))
    with open(resposta["arquivo"], "rb") as arquivo:
        inicio = arquivo.read(4096)

    assert b"Adobe" in inicio, "faltou o marcador Adobe no JPEG CMYK"


def test_o_psd_tambem_sai_em_quatro_canais(imagem_rgb, tmp_path):
    resposta = rgb_para_cmyk(_pedido(imagem_rgb, tmp_path / "saida.jpg", formatoImagem="psd"))
    assert resposta["arquivo"].lower().endswith(".psd")
    with open(resposta["arquivo"], "rb") as arquivo:
        assert arquivo.read(4) == b"8BPS"


def test_explica_por_que_o_png_nao_serve(imagem_rgb, tmp_path):
    """A nota precisa dizer que e o formato, e nao o programa, que nao pode."""
    resposta = rgb_para_cmyk(_pedido(imagem_rgb, tmp_path / "saida.png"))
    notas = " ".join(resposta["notas"])
    assert "PNG" in notas
    assert "nao guarda CMYK" in notas


def test_imagem_com_transparencia_nao_estoura(tmp_path):
    """Alfa nao existe em CMYK, e sem tirar antes a conversao recusa."""
    doc = pymupdf.open()
    pagina = doc.new_page(width=100, height=100)
    pagina.draw_rect(pymupdf.Rect(0, 0, 50, 100), color=None, fill=(1, 0, 0))
    pixels = pagina.get_pixmap(dpi=72, alpha=True)
    origem = tmp_path / "com-alfa.png"
    pixels.save(str(origem))
    doc.close()

    resposta = rgb_para_cmyk(_pedido(origem, tmp_path / "saida.jpg"))
    assert pymupdf.Pixmap(resposta["arquivo"]).n == 4


def test_a_qualidade_do_jpg_muda_o_tamanho(imagem_rgb, tmp_path):
    alta = rgb_para_cmyk(_pedido(imagem_rgb, tmp_path / "alta.jpg", qualidade=98))
    baixa = rgb_para_cmyk(_pedido(imagem_rgb, tmp_path / "baixa.jpg", qualidade=40))
    assert baixa["bytes"] < alta["bytes"]


def test_pdf_continua_saindo_pdf(tmp_path):
    """O caminho de documento nao pode ter sido afetado pelo de imagem."""
    doc = pymupdf.open()
    pagina = doc.new_page(width=200, height=100)
    pagina.draw_rect(pymupdf.Rect(0, 0, 100, 100), color=None, fill=(1, 0, 0))
    pagina.insert_text((10, 90), "texto", fontsize=12)
    origem = tmp_path / "documento.pdf"
    doc.save(str(origem))
    doc.close()

    resposta = rgb_para_cmyk(_pedido(origem, tmp_path / "saida.pdf"))
    with open(resposta["arquivo"], "rb") as arquivo:
        assert arquivo.read(4) == b"%PDF"
    # E o texto continua texto, que e a promessa do caminho de PDF.
    convertido = pymupdf.open(resposta["arquivo"])
    assert "texto" in convertido[0].get_text()
    convertido.close()


def test_o_catalogo_de_formatos_so_tem_quem_guarda_cmyk(tmp_path):
    """PNG nunca pode entrar nesta lista: o MuPDF recusa gravar CMYK nele."""
    assert "png" not in FORMATOS_CMYK

    doc = pymupdf.open()
    pagina = doc.new_page(width=50, height=50)
    pixels = pagina.get_pixmap(dpi=72, colorspace=pymupdf.csCMYK)
    doc.close()

    for formato in FORMATOS_CMYK:
        destino = str(tmp_path / f"prova.{formato}")
        pixels.save(destino)
        assert os.path.getsize(destino) > 0

    with pytest.raises(ValueError):
        pixels.save(str(tmp_path / "prova.png"))
