"""Dividir por tamanho tem que entregar partes que cabem no tamanho.

Este arquivo nasceu de uma tela: alguem pediu para dividir com limite de 1 MB
por parte e recebeu, entre as seis partes, uma de 3,9 MB e outra de 1,1 MB. A
divisao nao estava errada — uma pagina sozinha nao tem como ser dividida de
novo. Mas o programa tinha escrito "1 MB" na tela e entregue 3,9, sem uma
palavra sobre isso.

Agora a parte que passa e encolhida, e o que se testa aqui e a promessa
inteira: cabe no limite, o texto continua texto, e quando nao houver jeito a
nota diz que nao houve.
"""

from __future__ import annotations

import os
import random

import pymupdf
import pytest

from motor.encolher import DEGRAUS, apenas_arrumando, ate_caber
from motor.operacoes.organizar import dividir
from motor.protocolo import Pedido

UM_MB = 1024 * 1024


def _pixmap_pesado(largura: int, altura: int) -> pymupdf.Pixmap:
    """Ruido, que e o que nao comprime — como uma digitalizacao de verdade.

    Uma imagem chapada some no deflate e nao serviria para testar tamanho:
    ela ja caberia em qualquer limite antes de qualquer encolhimento.
    """
    random.seed(7)
    base = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, largura, altura), False)
    dados = bytearray(base.samples)
    for i in range(0, len(dados), 5):
        dados[i] = random.randint(120, 255)
    return pymupdf.Pixmap(pymupdf.csRGB, largura, altura, bytes(dados), False)


@pytest.fixture(scope="module")
def pdf_misto(tmp_path_factory):
    """Tres paginas leves de texto e uma pesada, como um documento digitalizado.

    Compartilhado pelo modulo inteiro de proposito. Montar a imagem de ruido
    de 2480x3508 custa alguns segundos, e refaze-la para cada um dos treze
    testes levava a suite de dez segundos para quase dois minutos — o que
    basta para as pessoas pararem de rodar os testes.

    Nenhum teste altera o arquivo: o que precisa gravar por cima faz copia
    antes. Cada teste continua tendo o seu proprio `tmp_path` para a saida.
    """
    doc = pymupdf.open()
    for numero in range(3):
        pagina = doc.new_page(width=595, height=842)
        pagina.insert_text((60, 80), f"Pagina leve numero {numero + 1}", fontsize=14)

    pesada = doc.new_page(width=595, height=842)
    pesada.insert_image(pesada.rect, pixmap=_pixmap_pesado(2480, 3508))
    pesada.insert_text((60, 60), "TEXTO SOBRE A DIGITALIZACAO", fontsize=16)

    caminho = tmp_path_factory.mktemp("origem") / "misto.pdf"
    doc.save(str(caminho), garbage=4, deflate=True)
    doc.close()
    return caminho


def _pedido(caminho, tmp_path, **opcoes):
    return Pedido(
        {
            "id": "1",
            "acao": "dividir",
            "arquivos": [str(caminho)],
            "opcoes": opcoes,
            "saida": str(tmp_path / "saida"),
        },
        lambda _linha: None,
    )


class TestEncolher:
    def test_arrumar_nao_toca_nas_imagens(self, pdf_misto, tmp_path):
        """O primeiro passo e o que nao custa qualidade nenhuma."""
        destino = str(tmp_path / "arrumado.pdf")
        apenas_arrumando(str(pdf_misto), destino)

        antes = pymupdf.open(str(pdf_misto))
        depois = pymupdf.open(destino)
        try:
            # Mesma imagem, mesmas medidas: nada foi reamostrado.
            assert [i[2:4] for i in antes[3].get_images()] == [i[2:4] for i in depois[3].get_images()]
            assert depois[3].get_text().strip() == antes[3].get_text().strip()
        finally:
            antes.close()
            depois.close()

    def test_cabe_no_limite_pedido(self, pdf_misto, tmp_path):
        destino = str(tmp_path / "encolhido.pdf")
        resultado = ate_caber(str(pdf_misto), destino, UM_MB)

        assert resultado.coube, f"nao coube: {resultado.bytes} bytes"
        assert os.path.getsize(destino) <= UM_MB
        assert resultado.bytes == os.path.getsize(destino)

    def test_o_texto_sobrevive_ao_encolhimento(self, pdf_misto, tmp_path):
        """A diferenca entre encolher e redesenhar a pagina como foto."""
        destino = str(tmp_path / "encolhido.pdf")
        ate_caber(str(pdf_misto), destino, 300 * 1024)

        doc = pymupdf.open(destino)
        try:
            assert "TEXTO SOBRE A DIGITALIZACAO" in doc[3].get_text()
            assert "Pagina leve numero 1" in doc[0].get_text()
            # E a imagem continua la — encolher nao pode virar apagar.
            assert doc[3].get_images(), "a imagem sumiu da pagina"
        finally:
            doc.close()

    def test_arquivo_que_ja_cabe_nao_perde_qualidade(self, tmp_path):
        """Se arrumar ja resolve, nenhuma imagem e tocada."""
        doc = pymupdf.open()
        doc.new_page().insert_text((60, 60), "documento leve")
        origem = tmp_path / "leve.pdf"
        doc.save(str(origem))
        doc.close()

        resultado = ate_caber(str(origem), str(tmp_path / "saida.pdf"), UM_MB)
        assert resultado.coube
        assert resultado.sem_perda, "um arquivo que ja cabia nao devia ter perdido nada"
        assert "sem tocar nas imagens" in resultado.conta

    def test_avisa_quando_nao_ha_jeito(self, pdf_misto, tmp_path):
        """Limite impossivel tem que ser dito, e nao disfarcado."""
        resultado = ate_caber(str(pdf_misto), str(tmp_path / "impossivel.pdf"), 200)
        assert not resultado.coube
        # Mesmo sem caber, entrega o menor que conseguiu em vez de nada.
        assert os.path.exists(str(tmp_path / "impossivel.pdf"))

    def test_a_escada_vai_do_leve_para_o_pesado(self):
        """Degrau fora de ordem faria a ferramenta cortar mais do que precisa."""
        dpis = [d["dpi"] for d in DEGRAUS]
        assert dpis == sorted(dpis, reverse=True)
        qualidades = [d["qualidade"] for d in DEGRAUS]
        assert qualidades == sorted(qualidades, reverse=True)

    def test_origem_e_destino_podem_ser_o_mesmo(self, pdf_misto, tmp_path):
        """E como o dividir chama: encolhe a parte por cima dela mesma."""
        copia = tmp_path / "copia.pdf"
        copia.write_bytes(pdf_misto.read_bytes())

        resultado = ate_caber(str(copia), str(copia), UM_MB)
        assert resultado.coube
        assert copia.stat().st_size <= UM_MB
        # E continua sendo um PDF legivel, e nao um arquivo pela metade.
        doc = pymupdf.open(str(copia))
        assert doc.page_count == 4
        doc.close()


class TestDividirPorTamanho:
    def test_toda_parte_cabe_no_limite(self, pdf_misto, tmp_path):
        """A promessa da tela: nenhuma parte passa do que foi pedido."""
        resposta = dividir(_pedido(pdf_misto, tmp_path, limiteBytes=UM_MB))

        assert resposta["arquivos"], "nao gerou parte nenhuma"
        for parte in resposta["arquivos"]:
            tamanho = os.path.getsize(parte["arquivo"])
            assert tamanho <= UM_MB, f"{os.path.basename(parte['arquivo'])} ficou com {tamanho} bytes"
            assert parte["bytes"] == tamanho, "o tamanho informado nao bate com o do disco"

    def test_nao_perde_nem_repete_pagina(self, pdf_misto, tmp_path):
        resposta = dividir(_pedido(pdf_misto, tmp_path, limiteBytes=UM_MB))
        assert sum(p["paginas"] for p in resposta["arquivos"]) == 4
        assert resposta["paginas"] == 4

    def test_conta_o_que_foi_encolhido(self, pdf_misto, tmp_path):
        resposta = dividir(_pedido(pdf_misto, tmp_path, limiteBytes=UM_MB))
        encolhidas = [p for p in resposta["arquivos"] if p.get("encolhido")]
        assert encolhidas, "a pagina pesada devia ter sido encolhida"
        assert any("encolhidas" in nota for nota in resposta["notas"])

    def test_sem_reduzir_entrega_como_antes(self, pdf_misto, tmp_path):
        """Quem nao quiser perder nada desliga, e ai a parte passa mesmo."""
        resposta = dividir(_pedido(pdf_misto, tmp_path, limiteBytes=UM_MB, reduzir=False))
        passaram = [p for p in resposta["arquivos"] if p.get("passou")]
        assert passaram, "sem reduzir, a pagina pesada tinha que passar do limite"
        assert any("nao couberam" in nota for nota in resposta["notas"])

    def test_paginas_leves_ficam_juntas(self, pdf_misto, tmp_path):
        """Encher a parte ate o limite, e nao uma pagina por arquivo."""
        resposta = dividir(_pedido(pdf_misto, tmp_path, limiteBytes=UM_MB))
        assert max(p["paginas"] for p in resposta["arquivos"]) > 1

    def test_o_modo_por_paginas_continua_igual(self, pdf_misto, tmp_path):
        """Sem `limiteBytes`, nada muda para quem ja usava."""
        resposta = dividir(_pedido(pdf_misto, tmp_path, porArquivo=2))
        assert len(resposta["arquivos"]) == 2
        assert all(p["paginas"] == 2 for p in resposta["arquivos"])
        assert "notas" not in resposta
