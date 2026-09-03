"""Peças que os testes compartilham.

O PyMuPDF cria PDF, entao os testes montam o documento que precisam em vez de
carregar arquivo de exemplo. Isso deixa o teste dizer exatamente o que esta
testando, e nao ha arquivo binario no repositorio para alguem ter que confiar.
"""

from __future__ import annotations

import json
import os
import sys
from typing import Any, Dict, List

import pymupdf
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from motor.operacoes import ACOES  # noqa: E402
from motor.protocolo import Pedido  # noqa: E402


@pytest.fixture
def criar_pdf(tmp_path):
    """Monta um PDF com o numero de paginas pedido, cada uma com o seu numero."""

    def montar(paginas: int = 3, nome: str = "teste.pdf", senha: str = "", texto: bool = True) -> str:
        doc = pymupdf.open()
        for numero in range(1, paginas + 1):
            pagina = doc.new_page(width=595, height=842)  # A4 em pontos
            if texto:
                pagina.insert_text((72, 120), f"Pagina {numero}", fontsize=36)

        caminho = str(tmp_path / nome)
        if senha:
            doc.save(
                caminho,
                encryption=pymupdf.PDF_ENCRYPT_AES_256,
                owner_pw=senha,
                user_pw=senha,
                permissions=pymupdf.PDF_PERM_PRINT,
            )
        else:
            doc.save(caminho)
        doc.close()
        return caminho

    return montar


@pytest.fixture
def rodar():
    """Executa uma acao do motor como o aplicativo executaria."""

    def executar(acao: str, arquivos: List[str], opcoes: Dict[str, Any] = None, senhas: List[str] = None, saida: str = "") -> Dict[str, Any]:
        registradas = []
        pedido = Pedido(
            {
                "id": "teste",
                "acao": acao,
                "arquivos": arquivos,
                "opcoes": opcoes or {},
                "senhas": senhas or [],
                "saida": saida,
            },
            registradas.append,
        )
        resultado = ACOES[acao](pedido)
        resultado["_andamento"] = [json.loads(json.dumps(linha)) for linha in registradas]
        return resultado

    return executar


@pytest.fixture
def criar_foto_teste(tmp_path):
    """Uma imagem de verdade em disco, para provar que foto entra nas ferramentas."""

    def montar(largura=600, altura=400, nome="foto.jpg"):
        doc = pymupdf.open()
        pagina = doc.new_page(width=largura, height=altura)
        pagina.draw_rect(pagina.rect, color=(0.2, 0.5, 0.8), fill=(0.2, 0.5, 0.8))
        caminho = str(tmp_path / nome)
        pagina.get_pixmap(dpi=72).save(caminho)
        doc.close()
        return caminho

    return montar
