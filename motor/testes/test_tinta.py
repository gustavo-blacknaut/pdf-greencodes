"""K100 e preto rico: preto de gráfica de verdade, em DeviceCMYK."""

from __future__ import annotations

import pymupdf

from motor.tinta import cmyk_do_cinza, fixar_devicecmyk, porcentagem


class TestPorcentagem:
    def test_0_por_cento_e_zero(self):
        assert porcentagem(0) == 0

    def test_100_por_cento_e_255(self):
        assert porcentagem(100) == 255

    def test_20_por_cento(self):
        assert porcentagem(20) == 51

    def test_nao_sai_da_faixa(self):
        assert porcentagem(-10) == 0
        assert porcentagem(200) == 255


class TestCmykDoCinza:
    def _cinza(self, tom, largura=4, altura=4):
        px = pymupdf.Pixmap(pymupdf.csGRAY, pymupdf.IRect(0, 0, largura, altura), False)
        px.clear_with(tom)
        return px

    def test_k100_escuro_vira_preto_puro(self):
        escuro = self._cinza(50)
        px = cmyk_do_cinza(escuro, corte=180, cmyk=(0, 0, 0, 100))
        assert list(px.samples[:4]) == [0, 0, 0, 255]

    def test_k100_claro_vira_papel(self):
        claro = self._cinza(220)
        px = cmyk_do_cinza(claro, corte=180, cmyk=(0, 0, 0, 100))
        assert list(px.samples[:4]) == [0, 0, 0, 0]

    def test_preto_rico_tem_ciano_e_magenta(self):
        escuro = self._cinza(50)
        px = cmyk_do_cinza(escuro, corte=180, cmyk=(20, 20, 0, 100))
        c, m, y, k = px.samples[:4]
        assert c == 51  # 20% de 255
        assert m == 51
        assert y == 0
        assert k == 255

    def test_o_corte_decide(self):
        meio = self._cinza(150)
        claro_no_corte_120 = cmyk_do_cinza(meio, corte=120, cmyk=(0, 0, 0, 100))
        escuro_no_corte_200 = cmyk_do_cinza(meio, corte=200, cmyk=(0, 0, 0, 100))
        assert claro_no_corte_120.samples[3] == 0  # acima do corte 120: papel
        assert escuro_no_corte_200.samples[3] == 255  # abaixo do corte 200: tinta

    def test_resultado_e_devicecmyk(self):
        px = cmyk_do_cinza(self._cinza(50), 180, (0, 0, 0, 100))
        assert px.colorspace.name == "DeviceCMYK"
        assert px.n == 4


class TestFixarDeviceCmyk:
    def test_troca_o_colorspace_para_devicecmyk(self, tmp_path):
        doc = pymupdf.open()
        pagina = doc.new_page(width=100, height=100)
        px = pymupdf.Pixmap(pymupdf.csCMYK, 4, 4, bytes([51, 51, 0, 255] * 16), False)
        pagina.insert_image(pymupdf.Rect(0, 0, 100, 100), pixmap=px)

        trocadas = fixar_devicecmyk(doc)
        assert trocadas == 1

        caminho = str(tmp_path / "cmyk.pdf")
        doc.save(caminho)
        doc.close()

        conferindo = pymupdf.open(caminho)
        for imagem in conferindo[0].get_images(full=True):
            cs = conferindo.xref_get_key(imagem[0], "ColorSpace")
            assert cs == ("name", "/DeviceCMYK")
        conferindo.close()

    def test_o_pixel_sobrevive_a_troca(self, tmp_path):
        doc = pymupdf.open()
        pagina = doc.new_page(width=100, height=100)
        px = pymupdf.Pixmap(pymupdf.csCMYK, 4, 4, bytes([20, 40, 0, 255] * 16), False)
        pagina.insert_image(pymupdf.Rect(0, 0, 100, 100), pixmap=px)
        fixar_devicecmyk(doc)

        caminho = str(tmp_path / "cmyk.pdf")
        doc.save(caminho)
        doc.close()

        conferindo = pymupdf.open(caminho)
        lido = conferindo[0].get_pixmap(dpi=36, colorspace=pymupdf.csCMYK)
        assert list(lido.samples[:4]) == [20, 40, 0, 255]
        conferindo.close()

    def test_pagina_sem_imagem_nao_quebra(self):
        doc = pymupdf.open()
        doc.new_page(width=100, height=100)
        assert fixar_devicecmyk(doc) == 0
        doc.close()


class TestTonsDePretoComTinta(object):
    def test_tinta_rgb_e_o_comportamento_de_sempre(self, criar_pdf, rodar, tmp_path):
        destino = str(tmp_path / "rgb.pdf")
        rodar("tons-de-preto", [criar_pdf(paginas=1)], {"tinta": "rgb", "dpi": 72}, saida=destino)

        doc = pymupdf.open(destino)
        for img in doc[0].get_images(full=True):
            info = doc.extract_image(img[0])
            assert info["colorspace"] == 1  # um canal só, sem CMYK
        doc.close()

    def test_tinta_k100_grava_devicecmyk(self, criar_pdf, rodar, tmp_path):
        destino = str(tmp_path / "k100.pdf")
        rodar("tons-de-preto", [criar_pdf(paginas=1)], {"tinta": "k100", "dpi": 72}, saida=destino)

        doc = pymupdf.open(destino)
        for img in doc[0].get_images(full=True):
            cs = doc.xref_get_key(img[0], "ColorSpace")
            assert cs == ("name", "/DeviceCMYK")
        doc.close()

    def test_tinta_rico_grava_c_e_m(self, criar_pdf, rodar, tmp_path):
        destino = str(tmp_path / "rico.pdf")
        rodar("tons-de-preto", [criar_pdf(paginas=1)], {"tinta": "rico", "dpi": 72}, saida=destino)

        doc = pymupdf.open(destino)
        px = doc[0].get_pixmap(dpi=72, colorspace=pymupdf.csCMYK)
        # A página tem texto preto em fundo branco; procura um pixel escuro.
        amostras = px.samples
        n = px.n
        achou_tinta_rica = False
        for i in range(0, len(amostras), n):
            c, m, y, k = amostras[i : i + 4]
            if k > 200 and c > 0 and m > 0:
                achou_tinta_rica = True
                break
        assert achou_tinta_rica, "esperava achar pixel com C e M além do K"
        doc.close()

    def test_notas_explicam_a_tinta_escolhida(self, criar_pdf, rodar, tmp_path):
        destino = str(tmp_path / "k100.pdf")
        resultado = rodar("tons-de-preto", [criar_pdf(paginas=1)], {"tinta": "k100", "dpi": 72}, saida=destino)
        assert any("K100" in n for n in resultado["notas"])
        assert any("ICC" in n for n in resultado["notas"])
