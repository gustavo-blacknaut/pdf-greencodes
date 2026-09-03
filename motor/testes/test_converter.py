"""PDF para imagem, imagem para PDF, e extrair imagens embutidas."""

from __future__ import annotations

import os

import pymupdf
import pytest

from motor.protocolo import ErroDoUsuario


@pytest.fixture
def criar_imagem(tmp_path):
    def montar(largura=400, altura=300, nome="foto.jpg", cor=(0.3, 0.5, 0.8)):
        doc = pymupdf.open()
        pagina = doc.new_page(width=largura, height=altura)
        pagina.draw_rect(pagina.rect, color=cor, fill=cor)
        caminho = str(tmp_path / nome)
        pagina.get_pixmap(dpi=72).save(caminho)
        doc.close()
        return caminho

    return montar


class TestPdfParaImagem:
    def test_gera_uma_imagem_por_pagina(self, criar_pdf, rodar, tmp_path):
        pasta = str(tmp_path / "saida")
        resultado = rodar("pdf-para-imagem", [criar_pdf(paginas=3)], {"dpi": 72}, saida=pasta)

        assert len(resultado["arquivos"]) == 3
        for item in resultado["arquivos"]:
            assert os.path.exists(item["arquivo"])
            assert item["bytes"] > 0

    def test_formato_png(self, criar_pdf, rodar, tmp_path):
        pasta = str(tmp_path / "saida")
        resultado = rodar("pdf-para-imagem", [criar_pdf(paginas=1)], {"formato": "png", "dpi": 72}, saida=pasta)
        assert resultado["arquivos"][0]["arquivo"].endswith(".png")

    def test_so_as_paginas_pedidas(self, criar_pdf, rodar, tmp_path):
        pasta = str(tmp_path / "saida")
        resultado = rodar("pdf-para-imagem", [criar_pdf(paginas=5)], {"paginas": "2, 4", "dpi": 72}, saida=pasta)
        assert len(resultado["arquivos"]) == 2


class TestImagemParaPdf:
    def test_uma_imagem_vira_uma_pagina(self, criar_imagem, rodar, tmp_path):
        destino = str(tmp_path / "saida.pdf")
        resultado = rodar("imagem-para-pdf", [criar_imagem()], {}, saida=destino)

        assert resultado["paginas"] == 1
        doc = pymupdf.open(destino)
        assert doc.page_count == 1
        doc.close()

    def test_varias_imagens_na_ordem(self, criar_imagem, rodar, tmp_path):
        a = criar_imagem(nome="a.jpg", cor=(1, 0, 0))
        b = criar_imagem(nome="b.jpg", cor=(0, 1, 0))
        destino = str(tmp_path / "saida.pdf")
        resultado = rodar("imagem-para-pdf", [a, b], {}, saida=destino)
        assert resultado["paginas"] == 2

    def test_mantem_a_proporcao_da_imagem(self, criar_imagem, rodar, tmp_path):
        # 400x300 = 4:3. A largura da pagina fica fixa (A4), a altura segue.
        destino = str(tmp_path / "saida.pdf")
        rodar("imagem-para-pdf", [criar_imagem(largura=400, altura=300)], {}, saida=destino)

        doc = pymupdf.open(destino)
        proporcao = doc[0].rect.width / doc[0].rect.height
        assert abs(proporcao - 400 / 300) < 0.01
        doc.close()

    def test_imagem_inexistente_reclama(self, tmp_path, rodar):
        with pytest.raises(ErroDoUsuario, match="não encontrei"):
            rodar("imagem-para-pdf", [str(tmp_path / "fantasma.jpg")], {})


class TestExtrairImagens:
    def test_extrai_a_imagem_embutida(self, criar_imagem, rodar, tmp_path):
        # Constrói um PDF real com uma imagem embutida dentro (não uma imagem
        # aberta direto — extrair-imagens olha para o objeto embutido).
        doc = pymupdf.open()
        pagina = doc.new_page(width=200, height=200)
        origem_imagem = criar_imagem(largura=100, altura=100)
        pagina.insert_image(pymupdf.Rect(0, 0, 100, 100), filename=origem_imagem)
        caminho_pdf = str(tmp_path / "com-imagem.pdf")
        doc.save(caminho_pdf)
        doc.close()

        pasta = str(tmp_path / "extraidas")
        resultado = rodar("extrair-imagens", [caminho_pdf], {}, saida=pasta)

        assert len(resultado["arquivos"]) == 1
        assert os.path.exists(resultado["arquivos"][0]["arquivo"])

    def test_pdf_sem_imagem_avisa_em_vez_de_falhar(self, criar_pdf, rodar, tmp_path):
        pasta = str(tmp_path / "extraidas")
        resultado = rodar("extrair-imagens", [criar_pdf(paginas=1)], {}, saida=pasta)
        assert resultado["arquivos"] == []
        assert any("nenhuma imagem" in n for n in resultado["notas"])

    def test_a_mesma_imagem_repetida_so_sai_uma_vez(self, criar_imagem, rodar, tmp_path):
        # Um logo no cabecalho de todas as paginas e a mesma imagem embutida
        # (mesmo xref); extrair nao deveria duplicar.
        origem_imagem = criar_imagem(largura=50, altura=50)
        doc = pymupdf.open()
        for _ in range(3):
            pagina = doc.new_page(width=200, height=200)
            pagina.insert_image(pymupdf.Rect(0, 0, 50, 50), filename=origem_imagem)
        caminho_pdf = str(tmp_path / "com-logo.pdf")
        doc.save(caminho_pdf, garbage=4)
        doc.close()

        pasta = str(tmp_path / "extraidas")
        resultado = rodar("extrair-imagens", [caminho_pdf], {}, saida=pasta)
        assert len(resultado["arquivos"]) == 1
