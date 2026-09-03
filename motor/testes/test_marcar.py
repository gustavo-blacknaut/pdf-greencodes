"""Numerar, marca d'água, cabeçalho e rodapé."""

from __future__ import annotations

import pymupdf
import pytest

from motor.protocolo import ErroDoUsuario


class TestNumerar:
    def test_escreve_o_numero_em_cada_pagina(self, criar_pdf, rodar, tmp_path):
        destino = str(tmp_path / "numerado.pdf")
        rodar("numerar", [criar_pdf(paginas=3, texto=False)], saida=destino)

        doc = pymupdf.open(destino)
        assert doc[0].get_text().strip() == "1"
        assert doc[1].get_text().strip() == "2"
        assert doc[2].get_text().strip() == "3"
        doc.close()

    def test_comecar_em_muda_o_primeiro_numero(self, criar_pdf, rodar, tmp_path):
        destino = str(tmp_path / "numerado.pdf")
        rodar("numerar", [criar_pdf(paginas=2, texto=False)], {"comecarEm": 5}, saida=destino)

        doc = pymupdf.open(destino)
        assert doc[0].get_text().strip() == "5"
        assert doc[1].get_text().strip() == "6"
        doc.close()

    def test_formato_com_total(self, criar_pdf, rodar, tmp_path):
        destino = str(tmp_path / "numerado.pdf")
        rodar("numerar", [criar_pdf(paginas=2, texto=False)], {"formato": "{n} de {total}"}, saida=destino)

        doc = pymupdf.open(destino)
        assert doc[0].get_text().strip() == "1 de 2"
        doc.close()

    def test_paginas_escolhidas_so_numera_essas(self, criar_pdf, rodar, tmp_path):
        destino = str(tmp_path / "numerado.pdf")
        rodar("numerar", [criar_pdf(paginas=4, texto=False)], {"paginas": "2, 4"}, saida=destino)

        doc = pymupdf.open(destino)
        assert doc[0].get_text().strip() == ""
        assert doc[1].get_text().strip() != ""
        doc.close()


class TestMarcaDagua:
    def test_escreve_o_texto_pedido(self, criar_pdf, rodar, tmp_path):
        destino = str(tmp_path / "marcado.pdf")
        rodar("marca-dagua", [criar_pdf(paginas=1)], {"texto": "CONFIDENCIAL"}, saida=destino)

        doc = pymupdf.open(destino)
        assert "CONFIDENCIAL" in doc[0].get_text()
        doc.close()

    def test_texto_vazio_e_recusado(self, criar_pdf, rodar):
        with pytest.raises(ErroDoUsuario, match="o que a marca"):
            rodar("marca-dagua", [criar_pdf(paginas=1)], {"texto": "  "})

    def test_nao_apaga_o_conteudo_original(self, criar_pdf, rodar, tmp_path):
        destino = str(tmp_path / "marcado.pdf")
        rodar("marca-dagua", [criar_pdf(paginas=1)], {"texto": "RASCUNHO"}, saida=destino)

        doc = pymupdf.open(destino)
        assert "Pagina 1" in doc[0].get_text()
        doc.close()


class TestCabecalhoRodape:
    def test_escreve_os_dois(self, criar_pdf, rodar, tmp_path):
        destino = str(tmp_path / "com-cr.pdf")
        rodar("cabecalho-rodape", [criar_pdf(paginas=1, texto=False)], {"cabecalho": "Empresa X", "rodape": "Confidencial"}, saida=destino)

        doc = pymupdf.open(destino)
        texto = doc[0].get_text()
        assert "Empresa X" in texto
        assert "Confidencial" in texto
        doc.close()

    def test_sem_nenhum_texto_reclama(self, criar_pdf, rodar):
        with pytest.raises(ErroDoUsuario, match="cabeçalho ou o rodapé"):
            rodar("cabecalho-rodape", [criar_pdf(paginas=1)], {})

    def test_substitui_n_e_total(self, criar_pdf, rodar, tmp_path):
        destino = str(tmp_path / "com-cr.pdf")
        rodar("cabecalho-rodape", [criar_pdf(paginas=3, texto=False)], {"rodape": "Página {n}/{total}"}, saida=destino)

        doc = pymupdf.open(destino)
        assert "Página 1/3" in doc[0].get_text()
        assert "Página 3/3" in doc[2].get_text()
        doc.close()
