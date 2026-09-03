"""Proteger e desbloquear."""

from __future__ import annotations

import pymupdf
import pytest

from motor.protocolo import ErroDoUsuario


class TestProteger:
    def test_coloca_senha_num_arquivo_sem_senha(self, criar_pdf, rodar, tmp_path):
        destino = str(tmp_path / "protegido.pdf")
        rodar("proteger", [criar_pdf(paginas=2)], {"senha": "segredo123"}, saida=destino)

        doc = pymupdf.open(destino)
        assert doc.needs_pass
        assert doc.authenticate("segredo123")
        doc.close()

    def test_senha_vazia_reclama(self, criar_pdf, rodar):
        with pytest.raises(ErroDoUsuario, match="senha"):
            rodar("proteger", [criar_pdf(paginas=1)], {"senha": ""})

    def test_troca_a_senha_de_um_arquivo_que_ja_tinha(self, criar_pdf, rodar, tmp_path):
        origem = criar_pdf(paginas=1, senha="antiga")
        destino = str(tmp_path / "nova.pdf")
        rodar("proteger", [origem], {"senha": "nova123"}, senhas=["antiga"], saida=destino)

        doc = pymupdf.open(destino)
        assert doc.authenticate("nova123")
        assert not doc.authenticate("antiga")
        doc.close()


class TestDesbloquear:
    def test_tira_a_senha_com_a_senha_certa(self, criar_pdf, rodar, tmp_path):
        origem = criar_pdf(paginas=2, senha="segredo")
        destino = str(tmp_path / "livre.pdf")
        rodar("desbloquear", [origem], {}, senhas=["segredo"], saida=destino)

        doc = pymupdf.open(destino)
        assert not doc.needs_pass
        doc.close()

    def test_sem_senha_informada_reclama(self, criar_pdf, rodar):
        origem = criar_pdf(paginas=1, senha="segredo")
        with pytest.raises(ErroDoUsuario, match="senha atual"):
            rodar("desbloquear", [origem], {})

    def test_senha_errada_reclama(self, criar_pdf, rodar):
        origem = criar_pdf(paginas=1, senha="certa")
        with pytest.raises(ErroDoUsuario, match="nao confere"):
            rodar("desbloquear", [origem], {}, senhas=["errada"])
