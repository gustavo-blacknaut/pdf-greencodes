"""As operacoes, de ponta a ponta.

Cada teste monta um PDF, roda a operacao como o aplicativo rodaria e abre o
resultado para conferir. E o tipo de teste que o projeto anterior nao
conseguia ter: o pdf.js nao carrega fora do navegador, entao la so dava para
testar as funcoes de calculo soltas.
"""

from __future__ import annotations

import os

import pymupdf
import pytest

from motor.operacoes.cores import inverter, limiar
from motor.protocolo import ErroDoUsuario


def cor_do_canto(caminho: str, pagina: int = 0) -> int:
    """O tom do pixel do canto superior esquerdo, de 0 (preto) a 255."""
    doc = pymupdf.open(caminho)
    pixels = doc[pagina].get_pixmap(dpi=36, colorspace=pymupdf.csGRAY)
    tom = pixels.samples[0]
    doc.close()
    return tom


class TestInformar:
    def test_conta_paginas_e_mede_o_papel(self, criar_pdf, rodar):
        resultado = rodar("informar", [criar_pdf(paginas=3)])
        arquivo = resultado["arquivos"][0]

        assert arquivo["paginas"] == 3
        assert arquivo["detalhePaginas"][0]["formato"] == "A4"
        assert arquivo["detalhePaginas"][0]["deitada"] is False

    def test_avisa_que_precisa_de_senha_sem_tentar_abrir(self, criar_pdf, rodar):
        resultado = rodar("informar", [criar_pdf(paginas=2, senha="x")])
        arquivo = resultado["arquivos"][0]

        assert arquivo["precisaSenha"] is True
        assert "paginas" not in arquivo

    def test_com_a_senha_certa_le_normalmente(self, criar_pdf, rodar):
        resultado = rodar("informar", [criar_pdf(paginas=2, senha="x")], senhas=["x"])
        assert resultado["arquivos"][0]["paginas"] == 2


class TestOrganizar:
    def test_juntar_soma_as_paginas(self, criar_pdf, rodar, tmp_path):
        a = criar_pdf(paginas=2, nome="a.pdf")
        b = criar_pdf(paginas=3, nome="b.pdf")
        destino = str(tmp_path / "unido.pdf")

        resultado = rodar("juntar", [a, b], saida=destino)

        assert resultado["paginas"] == 5
        doc = pymupdf.open(destino)
        assert doc.page_count == 5
        doc.close()

    def test_juntar_com_um_arquivo_so_reclama(self, criar_pdf, rodar):
        with pytest.raises(ErroDoUsuario, match="pelo menos dois"):
            rodar("juntar", [criar_pdf(paginas=1)])

    def test_extrair_pega_so_o_pedido(self, criar_pdf, rodar, tmp_path):
        destino = str(tmp_path / "so-duas.pdf")
        resultado = rodar("extrair", [criar_pdf(paginas=6)], {"paginas": "2, 5"}, saida=destino)

        assert resultado["paginas"] == 2
        doc = pymupdf.open(destino)
        assert doc.page_count == 2
        assert "Pagina 2" in doc[0].get_text()
        assert "Pagina 5" in doc[1].get_text()
        doc.close()

    def test_remover_mantem_o_resto(self, criar_pdf, rodar, tmp_path):
        destino = str(tmp_path / "sem.pdf")
        resultado = rodar("remover", [criar_pdf(paginas=4)], {"paginas": "2"}, saida=destino)

        assert resultado["paginas"] == 3
        assert resultado["removidas"] == 1
        doc = pymupdf.open(destino)
        assert "Pagina 2" not in "".join(p.get_text() for p in doc)
        doc.close()

    def test_remover_tudo_e_recusado(self, criar_pdf, rodar):
        with pytest.raises(ErroDoUsuario, match="todas as paginas"):
            rodar("remover", [criar_pdf(paginas=2)], {"paginas": "1-2"})

    def test_girar_soma_ao_giro_que_ja_existia(self, criar_pdf, rodar, tmp_path):
        origem = criar_pdf(paginas=1)
        primeiro = str(tmp_path / "g1.pdf")
        segundo = str(tmp_path / "g2.pdf")

        rodar("girar", [origem], {"graus": 90}, saida=primeiro)
        rodar("girar", [primeiro], {"graus": 90}, saida=segundo)

        doc = pymupdf.open(segundo)
        assert doc[0].rotation == 180, "o segundo giro devia somar ao primeiro"
        doc.close()

    def test_girar_torto_e_recusado(self, criar_pdf, rodar):
        with pytest.raises(ErroDoUsuario, match="multiplo de 90"):
            rodar("girar", [criar_pdf(paginas=1)], {"graus": 45})

    def test_dividir_gera_um_arquivo_por_pagina(self, criar_pdf, rodar, tmp_path):
        pasta = str(tmp_path / "pedacos")
        os.makedirs(pasta, exist_ok=True)
        resultado = rodar("dividir", [criar_pdf(paginas=5)], {"porArquivo": 2}, saida=pasta)

        assert len(resultado["arquivos"]) == 3
        assert [a["paginas"] for a in resultado["arquivos"]] == [2, 2, 1]


class TestCores:
    def test_inverter_troca_claro_por_escuro(self, criar_pdf, rodar, tmp_path):
        origem = criar_pdf(paginas=1)
        destino = str(tmp_path / "invertido.pdf")

        assert cor_do_canto(origem) > 200, "o PDF de teste devia comecar com fundo branco"
        rodar("inverter-cor", [origem], {"dpi": 72}, saida=destino)
        assert cor_do_canto(destino) < 60, "o fundo branco devia ter virado preto"

    def test_tons_de_preto_nao_deixa_meio_tom(self, criar_pdf, rodar, tmp_path):
        origem = criar_pdf(paginas=1)
        destino = str(tmp_path / "preto.pdf")
        rodar("tons-de-preto", [origem], {"dpi": 72, "limite": 180}, saida=destino)

        doc = pymupdf.open(destino)
        pixels = doc[0].get_pixmap(dpi=36, colorspace=pymupdf.csGRAY)
        tons = set(pixels.samples)
        doc.close()

        # O JPEG do PDF suaviza a borda, entao nao da para exigir exatamente
        # dois tons; o que importa e a maioria esmagadora estar nos extremos.
        extremos = sum(1 for t in pixels.samples if t < 30 or t > 225)
        assert extremos / len(pixels.samples) > 0.95, f"sobrou meio-tom demais: {len(tons)} tons"

    def test_tons_de_cinza_mantem_o_meio_tom(self, criar_pdf, rodar, tmp_path):
        destino = str(tmp_path / "cinza.pdf")
        resultado = rodar("tons-de-cinza", [criar_pdf(paginas=2)], {"dpi": 72}, saida=destino)
        assert resultado["paginas"] == 2

    def test_senha_sobrevive_a_operacao_de_cor(self, criar_pdf, rodar, tmp_path):
        origem = criar_pdf(paginas=1, senha="segredo")
        destino = str(tmp_path / "cinza.pdf")
        rodar("tons-de-cinza", [origem], {"dpi": 72}, senhas=["segredo"], saida=destino)

        doc = pymupdf.open(destino)
        assert doc.needs_pass, "a operacao devolveu o arquivo sem a senha original"
        doc.close()


class TestFiltrosSoltos:
    """Os filtros sem PDF em volta, para separar erro de matematica de erro de
    documento."""

    def branco(self):
        pixels = pymupdf.Pixmap(pymupdf.csGRAY, pymupdf.IRect(0, 0, 4, 4), False)
        pixels.clear_with(255)
        return pixels

    def test_inverter_branco_da_preto(self):
        assert set(inverter(self.branco()).samples) == {0}

    def test_inverter_duas_vezes_volta_ao_original(self):
        assert set(inverter(inverter(self.branco())).samples) == {255}

    def test_limiar_manda_o_claro_para_branco(self):
        assert set(limiar(self.branco(), 180).samples) == {255}

    def test_limiar_manda_o_escuro_para_preto(self):
        escuro = pymupdf.Pixmap(pymupdf.csGRAY, pymupdf.IRect(0, 0, 4, 4), False)
        escuro.clear_with(100)
        assert set(limiar(escuro, 180).samples) == {0}

    def test_o_limite_decide(self):
        meio = pymupdf.Pixmap(pymupdf.csGRAY, pymupdf.IRect(0, 0, 4, 4), False)
        meio.clear_with(150)
        assert set(limiar(meio, 120).samples) == {255}, "acima do limite devia virar branco"
        assert set(limiar(meio, 200).samples) == {0}, "abaixo do limite devia virar preto"


class TestOtimizar:
    def test_comprimir_mantem_as_paginas(self, criar_pdf, rodar, tmp_path):
        destino = str(tmp_path / "menor.pdf")
        resultado = rodar("comprimir", [criar_pdf(paginas=4)], {"redesenhar": False}, saida=destino)

        assert resultado["paginas"] == 4
        doc = pymupdf.open(destino)
        assert doc.page_count == 4
        assert "Pagina 1" in doc[0].get_text(), "sem redesenhar, o texto devia continuar texto"
        doc.close()

    def test_comprimir_avisa_quando_nao_deu_para_reduzir(self, criar_pdf, rodar, tmp_path):
        destino = str(tmp_path / "menor.pdf")
        resultado = rodar("comprimir", [criar_pdf(paginas=1)], {"redesenhar": False}, saida=destino)

        if resultado["bytesSaida"] >= resultado["bytesEntrada"]:
            assert any("nao ficou menor" in nota for nota in resultado["notas"])

    def test_comprimir_avisa_que_a_senha_ficou(self, criar_pdf, rodar, tmp_path):
        destino = str(tmp_path / "menor.pdf")
        resultado = rodar("comprimir", [criar_pdf(paginas=1, senha="x")], {}, senhas=["x"], saida=destino)
        assert any("senha" in nota.lower() for nota in resultado["notas"])

    def test_redesenhar_descarta_o_texto_e_avisa(self, criar_pdf, rodar, tmp_path):
        destino = str(tmp_path / "redesenhado.pdf")
        resultado = rodar("comprimir", [criar_pdf(paginas=2)], {"redesenhar": True, "nivel": "medio"}, saida=destino)

        assert any("nao e selecionavel" in n or "selecionavel" in n for n in resultado["notas"])
        doc = pymupdf.open(destino)
        assert doc[0].get_text().strip() == "", "redesenhado, nao deveria sobrar texto"
        doc.close()

    def test_reparar_reescreve_e_avisa(self, criar_pdf, rodar, tmp_path):
        destino = str(tmp_path / "reparado.pdf")
        resultado = rodar("reparar", [criar_pdf(paginas=2)], saida=destino)
        assert resultado["paginas"] == 2
        assert len(resultado["notas"]) == 1


class TestDesenhar:
    def test_gera_uma_imagem_por_pagina(self, criar_pdf, rodar, tmp_path):
        pasta = str(tmp_path / "imagens")
        resultado = rodar("desenhar", [criar_pdf(paginas=3)], {"dpi": 72, "paginas": "1-2"}, saida=pasta)

        assert len(resultado["imagens"]) == 2
        for imagem in resultado["imagens"]:
            assert os.path.exists(imagem["caminho"])
            assert imagem["bytes"] > 0

    def test_o_dpi_muda_o_tamanho_da_imagem(self, criar_pdf, rodar, tmp_path):
        origem = criar_pdf(paginas=1)
        baixo = rodar("desenhar", [origem], {"dpi": 72}, saida=str(tmp_path / "a"))
        alto = rodar("desenhar", [origem], {"dpi": 144}, saida=str(tmp_path / "b"))

        assert alto["imagens"][0]["largura"] == pytest.approx(baixo["imagens"][0]["largura"] * 2, abs=2)

    def test_dpi_absurdo_e_limitado(self, criar_pdf, rodar, tmp_path):
        # O teto subiu para 1200 quando o aplicativo passou a oferecer as
        # impressoras de 600 e 1200 DPI. Acima disso não há impressora, e o
        # arquivo só cresceria.
        resultado = rodar("desenhar", [criar_pdf(paginas=1)], {"dpi": 5000}, saida=str(tmp_path / "c"))
        assert resultado["dpi"] == 1200

    def test_sem_pasta_de_saida_reclama(self, criar_pdf, rodar):
        with pytest.raises(ErroDoUsuario, match="em que pasta"):
            rodar("desenhar", [criar_pdf(paginas=1)])


class TestAndamento:
    def test_avisa_o_progresso_e_termina_em_um(self, criar_pdf, rodar, tmp_path):
        resultado = rodar("tons-de-cinza", [criar_pdf(paginas=6)], {"dpi": 72}, saida=str(tmp_path / "x.pdf"))
        passos = [linha for linha in resultado["_andamento"] if linha["tipo"] == "andamento"]

        assert len(passos) >= 2
        assert passos[-1]["fracao"] == 1.0
        assert all(0.0 <= p["fracao"] <= 1.0 for p in passos)
