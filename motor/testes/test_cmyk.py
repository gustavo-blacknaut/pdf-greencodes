"""RGB para CMYK, com a receita de preto da casa."""

from __future__ import annotations

import re

import pymupdf
import pytest

from motor.operacoes.cmyk import PRETO_RICO, corrigir_neutros, tinta_equivalente
from motor.protocolo import ErroDoUsuario


def cores_do_pdf(caminho):
    """Todas as cores CMYK que o conteúdo do PDF manda desenhar."""
    doc = pymupdf.open(caminho)
    achadas = []
    for pagina in doc:
        conteudo = pagina.read_contents().decode("latin-1")
        for c in re.findall(r"([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+k\b", conteudo):
            achadas.append(tuple(round(float(v) * 100) for v in c))
    doc.close()
    return achadas


@pytest.fixture
def pdf_colorido(tmp_path):
    """Preto RGB, cinza 50%, vermelho e um texto — um de cada caso."""

    def montar(nome="cores.pdf"):
        doc = pymupdf.open()
        pagina = doc.new_page(width=300, height=260)
        pagina.insert_text((20, 40), "Texto preto", fontsize=22)
        pagina.draw_rect(pymupdf.Rect(20, 60, 280, 110), color=(0, 0, 0), fill=(0, 0, 0))
        pagina.draw_rect(pymupdf.Rect(20, 120, 280, 170), color=(0.5, 0.5, 0.5), fill=(0.5, 0.5, 0.5))
        pagina.draw_rect(pymupdf.Rect(20, 180, 280, 240), color=(1, 0, 0), fill=(1, 0, 0))
        caminho = str(tmp_path / nome)
        doc.save(caminho)
        doc.close()
        return caminho

    return montar


class TestTintaEquivalente:
    """Duas camadas de tinta não somam: 50% sobre 50% dá 75%, não 100%."""

    def test_sem_tinta_nenhuma(self):
        assert tinta_equivalente(0, 0, 0, 0) == 0

    def test_so_a_chapa_preta_cheia(self):
        assert tinta_equivalente(0, 0, 0, 1) == 1

    def test_cinza_do_perfil_da_meio_tom(self):
        # C51 M44 Y44 K8 é o que o perfil devolve para um cinza de 50%.
        assert 0.45 < tinta_equivalente(0.51, 0.44, 0.44, 0.08) < 0.55

    def test_preto_de_quadricromia_conta_como_preto(self):
        # C72 M67 Y67 K88 é o que o perfil devolve para preto RGB puro.
        assert tinta_equivalente(0.72, 0.67, 0.67, 0.88) > 0.94


class TestCorrigirNeutros:
    def test_preto_de_quadricromia_vira_a_receita_da_casa(self):
        saida, trocas = corrigir_neutros(b"0.72 0.67 0.67 0.88 k", PRETO_RICO)
        assert trocas == 1
        assert saida == b"0.2 0.2 0 1 k"

    def test_vale_para_o_traco_maiusculo_tambem(self):
        saida, _ = corrigir_neutros(b"0.72 0.67 0.67 0.88 K", PRETO_RICO)
        assert saida.endswith(b" K")

    def test_cinza_vai_so_para_a_chapa_preta(self):
        saida, trocas = corrigir_neutros(b"0.51 0.44 0.44 0.08 k", PRETO_RICO)
        assert trocas == 1
        assert saida.startswith(b"0 0 0 ")
        # ~50% de tinta equivalente
        assert 0.45 < float(saida.split()[3]) < 0.55

    def test_cor_de_verdade_nao_e_tocada(self):
        vermelho = b"0 1 1 0 k"
        saida, trocas = corrigir_neutros(vermelho, PRETO_RICO)
        assert saida == vermelho
        assert trocas == 0

    def test_branco_fica_branco(self):
        # Mexer aqui sujaria o papel com tinta que não devia existir.
        branco = b"0 0 0 0 k"
        saida, trocas = corrigir_neutros(branco, PRETO_RICO)
        assert saida == branco
        assert trocas == 0

    def test_nao_confunde_com_outro_operador(self):
        # `re` sem fronteira pegaria o "k" de "kkk" ou de um nome de recurso.
        original = b"0.5 0.5 0.5 0.5 kk"
        saida, trocas = corrigir_neutros(original, PRETO_RICO)
        assert trocas == 0
        assert saida == original

    def test_k100_puro_quando_pedido(self):
        saida, _ = corrigir_neutros(b"0.72 0.67 0.67 0.88 k", (0, 0, 0, 100))
        assert saida == b"0 0 0 1 k"


class TestConversaoCompleta:
    def test_preto_puro_sai_na_receita_da_casa(self, pdf_colorido, rodar, tmp_path):
        destino = str(tmp_path / "convertido.pdf")
        resultado = rodar("rgb-para-cmyk", [pdf_colorido()], {}, saida=destino)

        cores = cores_do_pdf(destino)
        assert (20, 20, 0, 100) in cores, f"esperava o preto da casa, achei {cores}"
        assert resultado["trocasDePreto"] > 0

    def test_nao_sobra_preto_de_quadricromia(self, pdf_colorido, rodar, tmp_path):
        destino = str(tmp_path / "convertido.pdf")
        rodar("rgb-para-cmyk", [pdf_colorido()], {}, saida=destino)

        for c, m, y, k in cores_do_pdf(destino):
            neutro = max(c, m, y) - min(c, m, y) <= 12
            if neutro and k > 90:
                assert (c, m, y) == (20, 20, 0), f"preto fora da receita: C{c} M{m} Y{y} K{k}"

    def test_a_cor_de_verdade_sobrevive(self, pdf_colorido, rodar, tmp_path):
        destino = str(tmp_path / "convertido.pdf")
        rodar("rgb-para-cmyk", [pdf_colorido()], {}, saida=destino)
        # Vermelho puro em CMYK é M e Y cheios, sem ciano.
        assert any(c == 0 and m > 90 and y > 90 for c, m, y, _ in cores_do_pdf(destino))

    def test_o_texto_continua_texto(self, pdf_colorido, rodar, tmp_path):
        destino = str(tmp_path / "convertido.pdf")
        rodar("rgb-para-cmyk", [pdf_colorido()], {}, saida=destino)

        doc = pymupdf.open(destino)
        assert "Texto preto" in doc[0].get_text()
        assert len(doc[0].get_images()) == 0, "nada devia ter virado imagem"
        doc.close()

    def test_grava_devicecmyk_por_padrao(self, tmp_path, rodar):
        # Um PDF com foto dentro, que é onde o ColorSpace da imagem importa.
        foto = tmp_path / "f.jpg"
        d = pymupdf.open()
        p = d.new_page(width=100, height=100)
        p.draw_rect(p.rect, color=(0.9, 0.3, 0.2), fill=(0.9, 0.3, 0.2))
        p.get_pixmap(dpi=72).save(str(foto))
        d.close()

        d = pymupdf.open()
        p = d.new_page(width=200, height=200)
        p.insert_image(pymupdf.Rect(10, 10, 190, 190), filename=str(foto))
        origem = str(tmp_path / "com-foto.pdf")
        d.save(origem)
        d.close()

        destino = str(tmp_path / "convertido.pdf")
        rodar("rgb-para-cmyk", [origem], {}, saida=destino)

        doc = pymupdf.open(destino)
        for imagem in doc[0].get_images(full=True):
            assert doc.xref_get_key(imagem[0], "ColorSpace") == ("name", "/DeviceCMYK")
        doc.close()

    def test_pode_manter_o_perfil_icc(self, pdf_colorido, rodar, tmp_path):
        destino = str(tmp_path / "convertido.pdf")
        resultado = rodar("rgb-para-cmyk", [pdf_colorido()], {"marcarDevice": False}, saida=destino)
        assert any("perfil ICC" in n for n in resultado["notas"])

    def test_pode_desligar_o_ajuste_de_preto(self, pdf_colorido, rodar, tmp_path):
        destino = str(tmp_path / "convertido.pdf")
        resultado = rodar("rgb-para-cmyk", [pdf_colorido()], {"ajustarPreto": False}, saida=destino)

        assert resultado["trocasDePreto"] == 0
        # Sem o ajuste, o preto de quadricromia do perfil continua lá.
        assert any(max(c, m, y) - min(c, m, y) <= 12 and k > 80 and c > 50 for c, m, y, k in cores_do_pdf(destino))

    def test_foto_solta_tambem_converte(self, criar_foto_teste, rodar, tmp_path):
        # Entrada JPG: `abrir` transforma em PDF de uma página antes.
        destino = str(tmp_path / "foto-cmyk.pdf")
        resultado = rodar("rgb-para-cmyk", [criar_foto_teste()], {}, saida=destino)
        assert resultado["paginas"] == 1

        doc = pymupdf.open(destino)
        for imagem in doc[0].get_images(full=True):
            assert doc.extract_image(imagem[0])["colorspace"] == 4
        doc.close()

    def test_sem_arquivo_reclama(self, rodar):
        with pytest.raises(ErroDoUsuario, match="nenhum arquivo"):
            rodar("rgb-para-cmyk", [], {})
