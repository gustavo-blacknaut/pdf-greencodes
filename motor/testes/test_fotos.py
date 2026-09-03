"""Folha de fotos: 3x4, 5x7, polaroid, adesivos."""

from __future__ import annotations

import pymupdf
import pytest

from motor.operacoes.fotos import cabem_quantas, encaixar, na_proporcao
from motor.protocolo import ErroDoUsuario


@pytest.fixture
def criar_foto(tmp_path):
    """Uma imagem retrato simples, para não depender de arquivo do usuário."""

    def montar(largura=800, altura=1000, nome="foto.jpg"):
        doc = pymupdf.open()
        pagina = doc.new_page(width=largura, height=altura)
        pagina.draw_rect(pagina.rect, color=(0.5, 0.5, 0.8), fill=(0.5, 0.5, 0.8))
        caminho = str(tmp_path / nome)
        pagina.get_pixmap(dpi=72).save(caminho)
        doc.close()
        return caminho

    return montar


class TestCabemQuantas:
    def test_3x4_em_10x15_da_nove(self):
        # É o número que o Corel também dá: 3 colunas por 3 linhas.
        colunas, linhas = cabem_quantas((30, 40), (100, 150), 0, 0)
        assert (colunas, linhas) == (3, 3)

    def test_papel_pequeno_demais_da_zero(self):
        assert cabem_quantas((100, 100), (50, 50), 0, 0) == (0, 0)


class TestEncaixar:
    def test_em_pe_por_padrao_mesmo_se_deitado_rende_mais(self):
        # 3x4 em 10x15 rende 10 deitado e 9 em pé; o padrão é o de sempre.
        colunas, linhas, girado = encaixar((30, 40), (100, 150), 0, 0)
        assert (colunas, linhas, girado) == (3, 3, False)

    def test_deitar_so_com_pedido_explicito(self):
        colunas, linhas, girado = encaixar((30, 40), (100, 150), 0, 0, deitar=True)
        assert colunas * linhas >= 9

    def test_nao_cabe_de_jeito_nenhum(self):
        with pytest.raises(ErroDoUsuario, match="não cabe"):
            encaixar((500, 500), (100, 150), 0, 0)

    def test_cabe_so_deitando_e_avisa(self):
        # Uma foto mais larga que o papel na vertical, mas que cabe deitada.
        with pytest.raises(ErroDoUsuario, match="marque a opção de deitar"):
            encaixar((140, 30), (100, 150), 0, 0, deitar=False)


class TestProporcao:
    def test_ja_na_proporcao_nao_muda(self):
        area = pymupdf.Rect(0, 0, 100, 100)
        assert na_proporcao(area, 1.0) == area

    def test_apara_a_largura_quando_area_e_mais_larga(self):
        area = pymupdf.Rect(0, 0, 200, 100)  # 2:1
        aparada = na_proporcao(area, 1.0)  # quer 1:1
        assert round(aparada.width) == round(aparada.height)
        assert aparada.height == 100  # a altura não muda

    def test_apara_a_altura_quando_area_e_mais_alta(self):
        area = pymupdf.Rect(0, 0, 100, 300)  # 1:3
        aparada = na_proporcao(area, 1.0)
        assert round(aparada.width) == round(aparada.height)
        assert aparada.width == 100


class TestFolhaDeFotos:
    def test_3x4_em_10x15_gera_nove_fotos(self, criar_foto, rodar, tmp_path):
        destino = str(tmp_path / "folha.pdf")
        resultado = rodar("folha-de-fotos", [criar_foto()], {"modelo": "3x4", "papel": "10x15"}, saida=destino)

        assert resultado["postas"] == 9
        assert resultado["colunas"] == 3
        assert resultado["linhas"] == 3

        doc = pymupdf.open(destino)
        assert len(doc[0].get_images()) == 9
        doc.close()

    def test_papel_no_tamanho_certo(self, criar_foto, rodar, tmp_path):
        destino = str(tmp_path / "folha.pdf")
        rodar("folha-de-fotos", [criar_foto()], {"modelo": "3x4", "papel": "10x15"}, saida=destino)

        doc = pymupdf.open(destino)
        MM = 25.4 / 72
        assert round(doc[0].rect.width * MM) == 100
        assert round(doc[0].rect.height * MM) == 150
        doc.close()

    def test_quantidade_limita_quantas_fotos_entram(self, criar_foto, rodar, tmp_path):
        destino = str(tmp_path / "folha.pdf")
        resultado = rodar("folha-de-fotos", [criar_foto()], {"modelo": "3x4", "papel": "10x15", "quantidade": 4}, saida=destino)
        assert resultado["postas"] == 4

    def test_previa_gera_imagem_nao_pdf(self, criar_foto, rodar, tmp_path):
        pasta = str(tmp_path)
        resultado = rodar("folha-de-fotos", [criar_foto()], {"modelo": "3x4", "papel": "10x15", "previa": True}, saida=pasta)
        assert resultado["arquivo"].endswith(".png")

    def test_modelo_desconhecido_reclama(self, criar_foto, rodar):
        with pytest.raises(ErroDoUsuario, match="não conheço o formato"):
            rodar("folha-de-fotos", [criar_foto()], {"modelo": "8x10-nao-existe"})

    def test_papel_desconhecido_reclama(self, criar_foto, rodar):
        with pytest.raises(ErroDoUsuario, match="não conheço o papel"):
            rodar("folha-de-fotos", [criar_foto()], {"modelo": "3x4", "papel": "gigante"})

    def test_recorte_respeita_a_fracao_pedida(self, criar_foto, rodar, tmp_path):
        """Não valida o pixel exato (a imagem final é reamostrada), só que a
        operação aceita o parâmetro e roda sem erro com um recorte não-trivial."""
        destino = str(tmp_path / "folha.pdf")
        resultado = rodar(
            "folha-de-fotos",
            [criar_foto()],
            {"modelo": "3x4", "papel": "10x15", "recorte": {"x": 0.1, "y": 0.05, "largura": 0.6, "altura": 0.7}},
            saida=destino,
        )
        assert resultado["postas"] == 9

    def test_polaroid_nunca_deita(self, criar_foto, rodar, tmp_path):
        destino = str(tmp_path / "folha.pdf")
        resultado = rodar("folha-de-fotos", [criar_foto()], {"modelo": "polaroid", "papel": "A4", "deitar": True}, saida=destino)
        assert resultado["girada"] is False

    def test_formatos_lista_todos_os_modelos_e_papeis(self, rodar):
        resultado = rodar("formatos", [])
        nomes = {m["id"] for m in resultado["modelos"]}
        assert {"3x4", "5x7", "polaroid", "adesivo-redondo", "13x18", "15x20"} <= nomes
        assert any(p["id"] == "10x15" for p in resultado["papeis"])

    def test_formatos_diz_o_papel_sugerido(self, rodar):
        resultado = rodar("formatos", [])
        por_id = {m["id"]: m for m in resultado["modelos"]}
        assert por_id["13x18"]["papelSugerido"] == "13x18"
        assert por_id["15x20"]["papelSugerido"] == "15x20"
        assert por_id["3x4"]["papelSugerido"] is None


class TestRevelacaoAvulsa:
    """10x15, 13x18 e 15x20 não são grade: são uma foto só, do tamanho do
    papel — a revelação de laboratório de verdade, sem borda branca."""

    def test_13x18_no_papel_13x18_preenche_sem_sobrar_borda(self, criar_foto, rodar, tmp_path):
        destino = str(tmp_path / "foto.pdf")
        resultado = rodar("folha-de-fotos", [criar_foto()], {"modelo": "13x18", "papel": "13x18"}, saida=destino)

        assert resultado["postas"] == 1
        assert resultado["colunas"] == 1
        assert resultado["linhas"] == 1

        doc = pymupdf.open(destino)
        MM = 25.4 / 72
        assert round(doc[0].rect.width * MM) == 130
        assert round(doc[0].rect.height * MM) == 180

        # A imagem cobre a pagina inteira: sem borda significa a caixa da
        # imagem batendo com a caixa da pagina, nao sobrando papel em volta.
        imagem = doc[0].get_image_bbox(doc[0].get_images(full=True)[0])
        pagina = doc[0].rect
        assert abs(imagem.width - pagina.width) < 1
        assert abs(imagem.height - pagina.height) < 1
        doc.close()

    def test_15x20_no_papel_15x20(self, criar_foto, rodar, tmp_path):
        destino = str(tmp_path / "foto.pdf")
        resultado = rodar("folha-de-fotos", [criar_foto()], {"modelo": "15x20", "papel": "15x20"}, saida=destino)
        assert resultado["postas"] == 1

        doc = pymupdf.open(destino)
        MM = 25.4 / 72
        assert round(doc[0].rect.width * MM) == 150
        assert round(doc[0].rect.height * MM) == 200
        doc.close()

    def test_nota_avisa_sem_borda(self, criar_foto, rodar, tmp_path):
        destino = str(tmp_path / "foto.pdf")
        resultado = rodar("folha-de-fotos", [criar_foto()], {"modelo": "10x15", "papel": "10x15"}, saida=destino)
        assert any("sem borda" in n for n in resultado["notas"])

    def test_13x18_num_papel_maior_deixa_borda_e_avisa(self, criar_foto, rodar, tmp_path):
        destino = str(tmp_path / "foto.pdf")
        resultado = rodar("folha-de-fotos", [criar_foto()], {"modelo": "13x18", "papel": "A4"}, saida=destino)
        assert any("com borda" in n for n in resultado["notas"])


class TestEsticar:
    """Sem esticar, um recorte fora de proporção é cortado pelo centro. Com
    esticar, o recorte inteiro entra, e o insert_image distorce para caber."""

    RECORTE_QUADRADO = {"x": 0.1, "y": 0.1, "largura": 0.8, "altura": 0.8}  # 1:1

    def proporcao_da_imagem_embutida(self, caminho_pdf):
        doc = pymupdf.open(caminho_pdf)
        info = doc.extract_image(doc[0].get_images(full=True)[0][0])
        doc.close()
        return info["width"] / info["height"]

    def test_sem_esticar_a_imagem_embutida_fica_na_proporcao_do_modelo(self, criar_foto, rodar, tmp_path):
        # Modelo 13x18: 130/180 = 0.722. Um recorte quadrado (1:1) tem que
        # sair cortado para bater com isso.
        destino = str(tmp_path / "cortado.pdf")
        rodar(
            "folha-de-fotos",
            [criar_foto(800, 800)],
            {"modelo": "13x18", "papel": "13x18", "recorte": self.RECORTE_QUADRADO, "esticar": False},
            saida=destino,
        )
        proporcao = self.proporcao_da_imagem_embutida(destino)
        assert abs(proporcao - 130 / 180) < 0.02

    def test_esticar_mantem_a_proporcao_do_recorte_original(self, criar_foto, rodar, tmp_path):
        destino = str(tmp_path / "esticado.pdf")
        rodar(
            "folha-de-fotos",
            [criar_foto(800, 800)],
            {"modelo": "13x18", "papel": "13x18", "recorte": self.RECORTE_QUADRADO, "esticar": True},
            saida=destino,
        )
        proporcao = self.proporcao_da_imagem_embutida(destino)
        assert abs(proporcao - 1.0) < 0.02, "a imagem esticada deveria continuar quadrada, sem corte"

    def test_pagina_sai_no_tamanho_certo_dos_dois_jeitos(self, criar_foto, rodar, tmp_path):
        # A pagina/casa nao muda com esticar: quem distorce e so a imagem,
        # nunca o layout da folha.
        destino = str(tmp_path / "esticado.pdf")
        rodar(
            "folha-de-fotos",
            [criar_foto(800, 800)],
            {"modelo": "13x18", "papel": "13x18", "recorte": self.RECORTE_QUADRADO, "esticar": True},
            saida=destino,
        )
        doc = pymupdf.open(destino)
        MM = 25.4 / 72
        assert round(doc[0].rect.width * MM) == 130
        assert round(doc[0].rect.height * MM) == 180
        doc.close()

    def test_avisa_quando_esticou_de_verdade(self, criar_foto, rodar, tmp_path):
        destino = str(tmp_path / "esticado.pdf")
        resultado = rodar(
            "folha-de-fotos",
            [criar_foto(800, 800)],
            {"modelo": "13x18", "papel": "13x18", "recorte": self.RECORTE_QUADRADO, "esticar": True},
            saida=destino,
        )
        assert any("esticada" in n for n in resultado["notas"])

    def test_nao_avisa_quando_o_recorte_ja_batia_com_a_proporcao(self, criar_foto, rodar, tmp_path):
        # Esticar ligado, mas o recorte ja tem a proporcao certa: nao houve
        # distorcao de verdade, entao o aviso nao deveria aparecer.
        destino = str(tmp_path / "sem-distorcao.pdf")
        # Fonte quadrada (800x800): a fração de largura precisa já carregar a
        # proporção 130:180, não a altura — largura menor que altura, porque
        # 13x18 é retrato.
        recorte_correto = {"x": 0, "y": 0, "largura": 130 / 180, "altura": 1}
        resultado = rodar(
            "folha-de-fotos",
            [criar_foto(800, 800)],
            {"modelo": "13x18", "papel": "13x18", "recorte": recorte_correto, "esticar": True},
            saida=destino,
        )
        assert not any("esticada" in n for n in resultado["notas"])
