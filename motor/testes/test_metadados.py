"""Limpar, definir e ler metadados."""

from __future__ import annotations

import pymupdf


def criar_com_metadados(criar_pdf, **campos):
    caminho = criar_pdf(paginas=1)
    doc = pymupdf.open(caminho)
    doc.set_metadata(campos)
    doc.saveIncr()
    doc.close()
    return caminho


class TestLimparMetadados:
    def test_apaga_titulo_e_autor(self, criar_pdf, rodar, tmp_path):
        origem = criar_com_metadados(criar_pdf, title="Contrato", author="Fulano")
        destino = str(tmp_path / "limpo.pdf")
        rodar("limpar-metadados", [origem], {}, saida=destino)

        doc = pymupdf.open(destino)
        assert doc.metadata.get("title", "") == ""
        assert doc.metadata.get("author", "") == ""
        doc.close()

    def test_nao_mexe_no_conteudo(self, criar_pdf, rodar, tmp_path):
        origem = criar_com_metadados(criar_pdf, title="X")
        destino = str(tmp_path / "limpo.pdf")
        resultado = rodar("limpar-metadados", [origem], {}, saida=destino)
        assert resultado["paginas"] == 1


class TestDefinirMetadados:
    def test_escreve_titulo_e_autor(self, criar_pdf, rodar, tmp_path):
        destino = str(tmp_path / "com-dados.pdf")
        rodar("definir-metadados", [criar_pdf(paginas=1)], {"title": "Relatório 2026", "author": "GreenCodes"}, saida=destino)

        doc = pymupdf.open(destino)
        assert doc.metadata["title"] == "Relatório 2026"
        assert doc.metadata["author"] == "GreenCodes"
        doc.close()

    def test_campo_em_branco_apaga(self, criar_pdf, rodar, tmp_path):
        origem = criar_com_metadados(criar_pdf, title="Antigo", author="Alguém")
        destino = str(tmp_path / "editado.pdf")
        rodar("definir-metadados", [origem], {"title": "Novo", "author": ""}, saida=destino)

        doc = pymupdf.open(destino)
        assert doc.metadata["title"] == "Novo"
        assert doc.metadata.get("author", "") == ""
        doc.close()

    def test_campo_nao_mencionado_mantem_o_que_tinha(self, criar_pdf, rodar, tmp_path):
        origem = criar_com_metadados(criar_pdf, title="Original", subject="Assunto")
        destino = str(tmp_path / "editado.pdf")
        rodar("definir-metadados", [origem], {"title": "Trocado"}, saida=destino)

        doc = pymupdf.open(destino)
        assert doc.metadata["title"] == "Trocado"
        assert doc.metadata["subject"] == "Assunto"
        doc.close()


class TestLerMetadados:
    def test_le_o_que_o_arquivo_tem(self, criar_pdf, rodar):
        origem = criar_com_metadados(criar_pdf, title="Título X", author="Autor Y")
        resultado = rodar("ler-metadados", [origem], {})
        assert resultado["title"] == "Título X"
        assert resultado["author"] == "Autor Y"

    def test_arquivo_sem_metadados_devolve_vazio(self, criar_pdf, rodar):
        resultado = rodar("ler-metadados", [criar_pdf(paginas=1)], {})
        assert resultado["title"] == ""
