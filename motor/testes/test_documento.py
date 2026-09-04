"""As regras de abrir, salvar e escolher paginas."""

from __future__ import annotations

import os

import pymupdf
import pytest

from motor.documento import abrir, faixa_de_paginas, nome_com_sufixo, salvar, variantes
from motor.protocolo import ErroDoUsuario


class TestFaixaDePaginas:
    def test_vazio_quer_dizer_tudo(self):
        assert faixa_de_paginas("", 4) == [0, 1, 2, 3]

    def test_pagina_solta(self):
        assert faixa_de_paginas("2", 5) == [1]

    def test_intervalo(self):
        assert faixa_de_paginas("2-4", 6) == [1, 2, 3]

    def test_lista_com_intervalo(self):
        assert faixa_de_paginas("1, 3-4, 6", 6) == [0, 2, 3, 5]

    def test_intervalo_aberto_no_fim(self):
        assert faixa_de_paginas("4-", 6) == [3, 4, 5]

    def test_intervalo_aberto_no_comeco(self):
        assert faixa_de_paginas("-3", 6) == [0, 1, 2]

    def test_ordem_invertida_e_aceita(self):
        # "5-2" e o mesmo pedido que "2-5"; recusar so criaria atrito.
        assert faixa_de_paginas("5-2", 6) == [1, 2, 3, 4]

    def test_repetida_entra_uma_vez_so(self):
        assert faixa_de_paginas("2, 2, 2", 4) == [1]

    def test_ignora_o_que_passa_do_fim(self):
        # Quem digita "1-999" querendo o documento inteiro esta sendo claro.
        assert faixa_de_paginas("1-999", 3) == [0, 1, 2]

    def test_reclama_quando_nada_existe(self):
        with pytest.raises(ErroDoUsuario, match="nenhuma das paginas"):
            faixa_de_paginas("50-60", 3)

    def test_reclama_de_texto_sem_sentido(self):
        with pytest.raises(ErroDoUsuario, match="nao entendi"):
            faixa_de_paginas("abc", 3)


class TestVariantesDeSenha:
    def test_sem_senha_e_uma_tentativa_vazia(self):
        assert variantes("") == [""]

    def test_tira_espaco_do_fim(self):
        assert "abc" in variantes("abc ")

    def test_tenta_as_duas_formas_de_acento(self):
        # Windows costuma gravar acento decomposto e o PDF composto.
        todas = variantes("señha")
        assert len(todas) >= 2
        assert any("̃" in forma for forma in todas)

    def test_nao_repete_tentativa(self):
        assert len(variantes("simples")) == len(set(variantes("simples")))


class TestNomeComSufixo:
    def test_poe_o_sufixo_antes_da_extensao(self):
        assert nome_com_sufixo("contrato.pdf", "comprimido").endswith("contrato-comprimido.pdf")

    def test_mantem_a_pasta(self):
        saida = nome_com_sufixo(os.path.join("C:", "docs", "a.pdf"), "x")
        assert "docs" in saida

    def test_troca_a_extensao_quando_pedido(self):
        assert nome_com_sufixo("a.pdf", "x", ".txt").endswith("a-x.txt")


class TestSenhaNoResultado:
    def test_arquivo_com_senha_abre_com_ela(self, criar_pdf):
        caminho = criar_pdf(paginas=2, senha="segredo")
        doc = abrir(caminho, "segredo")
        assert doc.page_count == 2
        doc.close()

    def test_arquivo_com_senha_recusa_sem_ela(self, criar_pdf):
        caminho = criar_pdf(paginas=1, senha="segredo")
        with pytest.raises(ErroDoUsuario, match="protegido por senha"):
            abrir(caminho)

    def test_senha_errada_diz_que_nao_confere(self, criar_pdf):
        caminho = criar_pdf(paginas=1, senha="certa")
        with pytest.raises(ErroDoUsuario, match="nao confere"):
            abrir(caminho, "errada")

    def test_salvar_com_senha_mantem_a_protecao(self, criar_pdf, tmp_path):
        """A falha que existia no aplicativo anterior: comprimir devolvia o
        arquivo sem senha, e ninguem avisava."""
        origem = criar_pdf(paginas=1, senha="segredo")
        doc = abrir(origem, "segredo")
        destino = str(tmp_path / "saida.pdf")
        salvar(doc, destino, "segredo")
        doc.close()

        conferindo = pymupdf.open(destino)
        assert conferindo.needs_pass, "o resultado saiu sem senha"
        assert conferindo.authenticate("segredo")
        conferindo.close()

    def test_arquivo_que_nao_existe_diz_o_nome(self, tmp_path):
        with pytest.raises(ErroDoUsuario, match="sumido.pdf"):
            abrir(str(tmp_path / "sumido.pdf"))


class TestImagemEntraComoPdf:
    """Uma foto tem que funcionar em qualquer ferramenta.

    O MuPDF abre JPG como documento, mas o que sai dali nao e PDF de verdade:
    show_pdf_page recusa com "is no PDF". Redimensionar, livreto e
    varias-por-folha quebravam assim quando recebiam foto.
    """

    def test_abre_imagem_como_pdf_de_uma_pagina(self, criar_foto_teste):
        doc = abrir(criar_foto_teste())
        assert doc.is_pdf, "a imagem deveria ter virado PDF de verdade"
        assert doc.page_count == 1
        doc.close()

    def test_redimensionar_aceita_foto(self, criar_foto_teste, rodar, tmp_path):
        destino = str(tmp_path / "foto-a4.pdf")
        resultado = rodar("redimensionar", [criar_foto_teste()], {"papel": "A4"}, saida=destino)
        assert resultado["paginas"] == 1

    def test_varias_por_folha_aceita_foto(self, criar_foto_teste, rodar, tmp_path):
        destino = str(tmp_path / "grade.pdf")
        resultado = rodar("varias-por-folha", [criar_foto_teste()], {"porFolha": 2}, saida=destino)
        assert resultado["paginas"] == 1

    def test_livreto_aceita_foto(self, criar_foto_teste, rodar, tmp_path):
        destino = str(tmp_path / "livreto.pdf")
        resultado = rodar("livreto", [criar_foto_teste()], saida=destino)
        assert resultado["paginas"] >= 1

    def test_arquivo_que_nao_e_imagem_nem_pdf_reclama_claro(self, tmp_path, rodar):
        lixo = tmp_path / "lixo.pdf"
        lixo.write_bytes(b"isso nao e um PDF nem uma imagem")
        with pytest.raises(ErroDoUsuario):
            abrir(str(lixo))
