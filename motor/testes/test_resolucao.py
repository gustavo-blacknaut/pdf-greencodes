"""A trava de resolução: 600 e 1200 DPI sem derrubar a máquina."""

from __future__ import annotations

from motor.resolucao import DPI_MAXIMO, DPI_MINIMO, TETO_DE_MEMORIA, bytes_da_pagina, couber, na_faixa

A4 = (595.0, 842.0)
A0 = (2384.0, 3370.0)


class TestNaFaixa:
    def test_deixa_passar_o_que_e_valido(self):
        for dpi in (72, 150, 300, 600, 1200):
            assert na_faixa(dpi) == dpi

    def test_600_e_1200_sao_aceitos(self):
        # É o que o usuário pediu: impressora de 600 e de 1200 existem.
        assert na_faixa(600) == 600
        assert na_faixa(1200) == 1200

    def test_corta_acima_do_maximo(self):
        assert na_faixa(5000) == DPI_MAXIMO

    def test_corta_abaixo_do_minimo(self):
        assert na_faixa(1) == DPI_MINIMO

    def test_texto_que_nao_e_numero_cai_no_padrao(self):
        assert na_faixa("alto", 150) == 150
        assert na_faixa(None, 200) == 200


class TestTamanhoDaPagina:
    def test_a4_a_300_dpi_em_rgb(self):
        # 595x842 pt = 8,26x11,69 pol -> 2480x3508 px -> ~26 MB em RGB
        tamanho = bytes_da_pagina(*A4, 300, 3)
        assert 24_000_000 < tamanho < 28_000_000

    def test_a4_a_1200_dpi_em_cmyk_passa_de_meio_giga(self):
        # É por isso que a trava existe.
        assert bytes_da_pagina(*A4, 1200, 4) > 500 * 1024 * 1024


class TestCouber:
    def test_o_que_cabe_passa_intacto(self):
        usado, baixou = couber(*A4, 300, 3)
        assert (usado, baixou) == (300, False)

    def test_a4_a_600_ainda_cabe(self):
        usado, baixou = couber(*A4, 600, 3)
        assert (usado, baixou) == (600, False)

    def test_a4_a_1200_em_cmyk_e_reduzido(self):
        usado, baixou = couber(*A4, 1200, 4)
        assert baixou is True
        assert usado < 1200

    def test_o_que_sobra_cabe_de_verdade(self):
        # A promessa da função: o que ela devolve não estoura o teto.
        for largura, altura in (A4, A0):
            for canais in (1, 3, 4):
                usado, _ = couber(largura, altura, 1200, canais)
                assert bytes_da_pagina(largura, altura, usado, canais) <= TETO_DE_MEMORIA

    def test_pagina_gigante_reduz_mais(self):
        # A0 tem 16 vezes a área de uma A4: sobra bem menos resolução.
        a4, _ = couber(*A4, 1200, 4)
        a0, _ = couber(*A0, 1200, 4)
        assert a0 < a4

    def test_nunca_devolve_abaixo_do_minimo(self):
        usado, _ = couber(10000.0, 10000.0, 1200, 4)
        assert usado >= DPI_MINIMO
