"""Separacao de chapas e cobertura de tinta.

Os dois so provam alguma coisa se o teste ler o resultado de volta e conferir
a cor, e nao apenas o tamanho do arquivo. Uma chapa de ciano vazia e uma chapa
de ciano cheia geram PDFs do mesmo tamanho.
"""

from __future__ import annotations

import pymupdf
import pytest

from motor.operacoes.chapas import LIMITES_DE_TINTA, _resumo_da_cobertura
from motor.protocolo import ErroDoUsuario


@pytest.fixture
def pdf_de_cores(tmp_path):
    """Uma pagina com um retangulo puro de cada cor primaria, mais preto."""

    def montar(nome="cores.pdf"):
        doc = pymupdf.open()
        pagina = doc.new_page(width=400, height=400)
        pagina.draw_rect(pymupdf.Rect(0, 0, 200, 200), color=(0, 1, 1), fill=(0, 1, 1))  # ciano
        pagina.draw_rect(pymupdf.Rect(200, 0, 400, 200), color=(1, 0, 1), fill=(1, 0, 1))  # magenta
        pagina.draw_rect(pymupdf.Rect(0, 200, 200, 400), color=(1, 1, 0), fill=(1, 1, 0))  # amarelo
        pagina.draw_rect(pymupdf.Rect(200, 200, 400, 400), color=(0, 0, 0), fill=(0, 0, 0))  # preto
        caminho = str(tmp_path / nome)
        doc.save(caminho)
        doc.close()
        return caminho

    return montar


def tom_medio(caminho, pagina_numero, retangulo):
    """A media de cinza de um pedaco da pagina. 0 e preto, 255 e branco."""
    doc = pymupdf.open(caminho)
    pixels = doc[pagina_numero].get_pixmap(dpi=72, colorspace=pymupdf.csGRAY, clip=retangulo)
    amostra = pixels.samples
    media = sum(amostra) / len(amostra)
    doc.close()
    return media


class TestSepararChapas:
    def test_sai_uma_pagina_por_chapa(self, rodar, criar_pdf):
        resultado = rodar("separar-chapas", [criar_pdf(paginas=2)], {"dpi": 72})

        assert resultado["paginas"] == 8  # 2 paginas x 4 chapas
        doc = pymupdf.open(resultado["arquivo"])
        assert doc.page_count == 8
        doc.close()

    def test_escolher_so_o_preto_sai_uma_chapa(self, rodar, criar_pdf):
        resultado = rodar("separar-chapas", [criar_pdf(paginas=1)], {"dpi": 72, "chapas": "k"})

        assert resultado["chapas"] == ["preto"]
        assert resultado["paginas"] == 1

    def test_a_chapa_sai_positiva_e_nao_em_negativo(self, rodar, pdf_de_cores):
        """Escuro e onde tem tinta.

        As duas escalas correm em sentidos opostos — no CMYK 0 e sem tinta, no
        cinza 0 e preto — e esquecer a inversao entrega a chapa em negativo,
        que imprime o exato oposto do desenho.
        """
        resultado = rodar("separar-chapas", [pdf_de_cores()], {"dpi": 72})

        quadrante_do_preto = pymupdf.Rect(220, 220, 380, 380)
        quadrante_do_ciano = pymupdf.Rect(20, 20, 180, 180)
        chapa_do_preto = 3

        entintado = tom_medio(resultado["arquivo"], chapa_do_preto, quadrante_do_preto)
        limpo = tom_medio(resultado["arquivo"], chapa_do_preto, quadrante_do_ciano)

        assert entintado < 100, "a area preta deveria sair escura na chapa do preto"
        assert limpo > 180, "o quadrante do ciano quase nao leva preto: deveria sair claro"

    def test_cada_cor_aparece_na_propria_chapa(self, rodar, pdf_de_cores):
        """O ciano imprime na chapa dele e quase nada na do amarelo.

        Sem numero absoluto de proposito: um ciano RGB puro nao vira 100% de
        tinta ciano, vira 51%, porque a conversao passa por colorimetria. O
        que tem de valer e a diferenca entre as chapas.
        """
        resultado = rodar("separar-chapas", [pdf_de_cores()], {"dpi": 72})

        quadrante_do_ciano = pymupdf.Rect(20, 20, 180, 180)
        na_chapa_do_ciano = tom_medio(resultado["arquivo"], 0, quadrante_do_ciano)
        na_chapa_do_amarelo = tom_medio(resultado["arquivo"], 2, quadrante_do_ciano)

        assert na_chapa_do_ciano < na_chapa_do_amarelo - 50

    def test_recusa_pedido_sem_nenhuma_chapa(self, rodar, criar_pdf):
        # "nada" nao tem c, m, y nem k. Um "xyz" passaria pelo y do amarelo.
        with pytest.raises(ErroDoUsuario, match="ao menos uma chapa"):
            rodar("separar-chapas", [criar_pdf(paginas=1)], {"chapas": "nada"})

    def test_avisa_o_andamento(self, rodar, criar_pdf):
        resultado = rodar("separar-chapas", [criar_pdf(paginas=3)], {"dpi": 72})
        assert len(resultado["_andamento"]) >= 2


class TestResumoDaCobertura:
    """A conta, sem PDF no meio. Cada canal vai de 0 a 255; a soma dos quatro e 400%."""

    def test_papel_em_branco_nao_recebe_tinta(self):
        vazio = [bytes([0] * 100)] * 4
        maior, media, acima = _resumo_da_cobertura(vazio, limite=300)
        assert (maior, media, acima) == (0, 0.0, 0.0)

    def test_quatro_canais_cheios_dao_400_por_cento(self):
        cheio = [bytes([255] * 100)] * 4
        maior, media, acima = _resumo_da_cobertura(cheio, limite=300)
        assert maior == 400
        assert media == 400.0
        assert acima == 100.0

    def test_k100_puro_da_100_por_cento(self):
        so_preto = [bytes([0] * 100), bytes([0] * 100), bytes([0] * 100), bytes([255] * 100)]
        maior, _, acima = _resumo_da_cobertura(so_preto, limite=300)
        assert maior == 100
        assert acima == 0.0, "K100 nunca estoura o limite de nenhum papel"

    def test_a_area_acima_do_limite_e_medida(self):
        """Metade dos pixels com as quatro chapas cheias, metade em branco."""
        metade = bytes([255] * 50 + [0] * 50)
        _, _, acima = _resumo_da_cobertura([metade] * 4, limite=300)
        assert acima == pytest.approx(50.0, abs=1.0)

    def test_canal_vazio_nao_estoura(self):
        assert _resumo_da_cobertura([b"", b"", b"", b""], limite=300) == (0, 0.0, 0.0)


class TestCoberturaDeTinta:
    def test_mede_cada_pagina(self, rodar, criar_pdf):
        resultado = rodar("cobertura-de-tinta", [criar_pdf(paginas=3)], {"dpi": 72})

        assert len(resultado["paginas"]) == 3
        for pagina in resultado["paginas"]:
            assert 0 <= pagina["maior"] <= 400

    def test_papel_conhecido_traz_o_limite_dele(self, rodar, criar_pdf):
        resultado = rodar("cobertura-de-tinta", [criar_pdf(paginas=1)], {"papel": "jornal", "dpi": 72})
        assert resultado["limite"] == LIMITES_DE_TINTA["jornal"] == 240

    def test_papel_desconhecido_cai_no_limite_informado(self, rodar, criar_pdf):
        resultado = rodar("cobertura-de-tinta", [criar_pdf(paginas=1)], {"papel": "linho", "limite": 280, "dpi": 72})
        assert resultado["limite"] == 280

    def test_preto_rgb_estoura_o_jornal(self, rodar, pdf_de_cores):
        """O motivo de a ferramenta existir.

        Um preto RGB convertido por perfil vira quase quatro chapas cheias.
        Num papel jornal, que aguenta 240%, isso e tinta demais.
        """
        resultado = rodar("cobertura-de-tinta", [pdf_de_cores()], {"papel": "jornal", "dpi": 72})

        assert resultado["paginas"][0]["maior"] > 240
        assert resultado["estouradas"] == 1
        assert any("passaram do limite" in nota for nota in resultado["notas"])

    def test_o_limite_fica_preso_entre_100_e_400(self, rodar, criar_pdf):
        arquivo = criar_pdf(paginas=1)
        assert rodar("cobertura-de-tinta", [arquivo], {"papel": "x", "limite": 5, "dpi": 72})["limite"] == 100
        assert rodar("cobertura-de-tinta", [arquivo], {"papel": "x", "limite": 900, "dpi": 72})["limite"] == 400

    def test_grava_o_laudo_em_arquivo(self, rodar, criar_pdf):
        """O laudo tem que sobreviver ao fechamento da janela."""
        resultado = rodar("cobertura-de-tinta", [criar_pdf(paginas=2)], {"dpi": 72})

        assert resultado["arquivo"].endswith(".txt")
        with open(resultado["arquivo"], encoding="utf-8") as laudo:
            texto = laudo.read()
        assert "Cobertura de tinta" in texto
        assert "limite de 300%" in texto
        # Uma linha por pagina, alem do cabecalho.
        assert texto.count("%\n") >= 2
