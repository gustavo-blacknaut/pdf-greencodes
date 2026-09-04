"""Várias por folha, livreto, dividir páginas, cortar, redimensionar."""

from __future__ import annotations

import pymupdf
import pytest

from motor.protocolo import ErroDoUsuario


class TestVariasPorFolha:
    def test_quatro_por_folha_junta_quatro_em_uma(self, criar_pdf, rodar, tmp_path):
        destino = str(tmp_path / "4-em-1.pdf")
        resultado = rodar("varias-por-folha", [criar_pdf(paginas=8)], {"porFolha": 4}, saida=destino)

        assert resultado["paginas"] == 2
        doc = pymupdf.open(destino)
        assert doc.page_count == 2
        doc.close()

    def test_sobra_de_pagina_ainda_gera_folha(self, criar_pdf, rodar, tmp_path):
        destino = str(tmp_path / "x.pdf")
        resultado = rodar("varias-por-folha", [criar_pdf(paginas=5)], {"porFolha": 4}, saida=destino)
        assert resultado["paginas"] == 2  # 4 + 1, a segunda folha semi-vazia

    def test_quantidade_invalida_reclama(self, criar_pdf, rodar):
        with pytest.raises(ErroDoUsuario, match="não sei montar"):
            rodar("varias-por-folha", [criar_pdf(paginas=2)], {"porFolha": 5})

    def test_conteudo_continua_texto(self, criar_pdf, rodar, tmp_path):
        """Show_pdf_page não rasteriza: diferente das operações de cor, o
        texto tem que continuar selecionável."""
        destino = str(tmp_path / "2-em-1.pdf")
        rodar("varias-por-folha", [criar_pdf(paginas=2)], {"porFolha": 2}, saida=destino)

        doc = pymupdf.open(destino)
        assert "Pagina 1" in doc[0].get_text()
        assert "Pagina 2" in doc[0].get_text()
        doc.close()


class TestLivreto:
    def test_oito_paginas_vira_quatro_lados_em_duas_folhas_fisicas(self, criar_pdf, rodar, tmp_path):
        destino = str(tmp_path / "livreto.pdf")
        resultado = rodar("livreto", [criar_pdf(paginas=8)], saida=destino)
        # 8 páginas / 2 por lado = 4 lados de impressão; cada folha física
        # duplex leva 2 lados, então 2 folhas físicas.
        assert resultado["paginas"] == 4
        assert resultado["folhasFisicas"] == 2

    def test_completa_com_branco_ate_multiplo_de_quatro(self, criar_pdf, rodar, tmp_path):
        destino = str(tmp_path / "livreto.pdf")
        resultado = rodar("livreto", [criar_pdf(paginas=6)], saida=destino)
        assert any("branco" in n for n in resultado["notas"])

    def test_primeira_folha_tem_a_ultima_pagina_ao_lado_da_primeira(self, criar_pdf, rodar, tmp_path):
        """A regra clássica de imposição: capa externa carrega página 1 e a
        última juntas."""
        destino = str(tmp_path / "livreto.pdf")
        rodar("livreto", [criar_pdf(paginas=4)], saida=destino)

        doc = pymupdf.open(destino)
        texto_primeira_folha = doc[0].get_text()
        assert "Pagina 4" in texto_primeira_folha
        assert "Pagina 1" in texto_primeira_folha
        doc.close()


class TestDividirPaginas:
    def test_dobra_o_numero_de_paginas(self, criar_pdf, rodar, tmp_path):
        destino = str(tmp_path / "dividido.pdf")
        resultado = rodar("dividir-paginas", [criar_pdf(paginas=3)], {"sentido": "vertical"}, saida=destino)
        assert resultado["paginas"] == 6


class TestCortar:
    def test_apara_e_muda_o_tamanho_visivel(self, criar_pdf, rodar, tmp_path):
        destino = str(tmp_path / "cortado.pdf")
        rodar("cortar", [criar_pdf(paginas=1)], {"esquerda": 10, "direita": 10, "topo": 10, "base": 10}, saida=destino)

        doc = pymupdf.open(destino)
        # A4 = 595x842pt; 10mm de cada lado = ~28.3pt de cada lado
        assert doc[0].rect.width < 595
        assert doc[0].rect.height < 842
        doc.close()

    def test_corte_absurdo_e_recusado(self, criar_pdf, rodar):
        with pytest.raises(ErroDoUsuario, match="não deixaria nada"):
            rodar("cortar", [criar_pdf(paginas=1)], {"esquerda": 500, "direita": 500})


class TestRedimensionar:
    def test_muda_para_o_papel_pedido(self, criar_pdf, rodar, tmp_path):
        destino = str(tmp_path / "carta.pdf")
        rodar("redimensionar", [criar_pdf(paginas=2)], {"papel": "carta"}, saida=destino)

        doc = pymupdf.open(destino)
        assert round(doc[0].rect.width) == 612
        assert round(doc[0].rect.height) == 792
        doc.close()
