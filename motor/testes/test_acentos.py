"""Nome de arquivo com acento tem que atravessar o canal inteiro.

Este arquivo existe por causa de um erro que matava o motor de vez.

No Windows o `sys.stdin` do Python nasce em cp1252 com `surrogateescape`, e o
aplicativo escreve UTF-8. Os dois bytes de um "I" com acento (C3 8D) eram
lidos como "A" com til mais o byte 8D, que nao existe em cp1252 — o
`surrogateescape` guardava esse byte como um substituto solto.

Na volta, esse substituto nao tem como ser gravado em UTF-8. A escrita
estourava dentro do `_escrever`, e nao era um pedido que falhava: era o canal
que morria. O motor saia com "lost sys.stderr" e, dali em diante, NENHUMA
ferramenta respondia mais — juntar, imprimir, inverter cor, todas mudas, sem
o aplicativo saber por que.

Uma aluna com um arquivo chamado "Lista de Rev BIOQUIMICA 2026.pdf" derrubava
o programa inteiro.

Os testes daqui rodam o motor de verdade, por um processo separado, porque e
so ali que o defeito existe: chamar a funcao direto em Python nunca passa pelo
stdin, e passa verde com o bug no lugar.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys

import pymupdf
import pytest

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PRINCIPAL = os.path.join(RAIZ, "principal.py")

# Um pouco de tudo o que aparece em nome de arquivo no Brasil, mais o travessao
# que o Word gosta de trocar sozinho.
ACENTUADO = "Revisao BIOQUIMICA \u2014 \u00e7\u00e3\u00f5\u00c1\u00cd\u00da 2026"


def conversar(pedidos: list[dict]) -> tuple[list[dict], str, int]:
    """Fala com o motor pelo mesmo caminho do aplicativo: stdin e stdout.

    Manda os bytes em UTF-8 explicitamente, que e o que o Node manda, e le a
    resposta em UTF-8. Deixar o Python escolher a codificacao aqui esconderia
    justamente o defeito que este arquivo persegue.
    """
    entrada = "".join(json.dumps(p, ensure_ascii=False) + "\n" for p in pedidos)
    processo = subprocess.run(
        [sys.executable, PRINCIPAL],
        input=entrada.encode("utf-8"),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=120,
    )
    respostas = [
        json.loads(linha)
        for linha in processo.stdout.decode("utf-8").splitlines()
        if linha.strip()
    ]
    return respostas, processo.stderr.decode("utf-8", "replace"), processo.returncode


@pytest.fixture()
def pdf_acentuado(tmp_path):
    caminho = tmp_path / f"{ACENTUADO}.pdf"
    doc = pymupdf.open()
    for numero in range(4):
        doc.new_page().insert_text((72, 72), f"pagina {numero + 1}")
    doc.save(str(caminho))
    doc.close()
    return caminho


def test_arquivo_que_nao_existe_nao_derruba_o_canal(tmp_path):
    """O caso relatado, que e o pior: o erro nao chegava nem a ser um erro.

    O motor tentava responder "nao encontrei o arquivo", nao conseguia gravar
    a resposta, e morria no meio dela.
    """
    sumido = str(tmp_path / f"{ACENTUADO}.pdf")
    respostas, _, codigo = conversar([{"id": "1", "acao": "informar", "arquivos": [sumido]}])

    assert codigo == 0, "o motor saiu com erro em vez de responder"
    assert len(respostas) == 1
    assert respostas[0]["tipo"] == "erro"
    # E o nome volta legivel, senao a mensagem na tela nao ajuda ninguem.
    assert "BIOQUIMICA" in respostas[0]["erro"]
    assert "\u00e7\u00e3\u00f5" in respostas[0]["erro"]


def test_o_canal_continua_vivo_depois_do_erro(tmp_path):
    """O estrago de verdade era este: tudo depois parava de responder."""
    sumido = str(tmp_path / f"{ACENTUADO}.pdf")
    respostas, _, codigo = conversar(
        [
            {"id": "1", "acao": "informar", "arquivos": [sumido]},
            {"id": "2", "acao": "informar", "arquivos": [sumido]},
            {"id": "3", "acao": "informar", "arquivos": [sumido]},
        ]
    )

    assert codigo == 0
    assert [r["id"] for r in respostas] == ["1", "2", "3"], "o motor morreu no meio da fila"


def test_abre_e_divide_arquivo_de_verdade(pdf_acentuado, tmp_path):
    """Ler o nome certo tem que levar ao arquivo certo no disco."""
    respostas, _, codigo = conversar(
        [
            {"id": "1", "acao": "informar", "arquivos": [str(pdf_acentuado)]},
            {
                "id": "2",
                "acao": "dividir",
                "arquivos": [str(pdf_acentuado)],
                "opcoes": {"modo": "cada", "cada": 1},
                "saida": str(tmp_path),
            },
        ]
    )

    assert codigo == 0
    fins = [r for r in respostas if r["tipo"] == "fim"]
    assert len(fins) == 2, [r.get("erro") for r in respostas]

    assert fins[0]["dados"]["arquivos"][0]["paginas"] == 4
    gerados = fins[1]["dados"]["arquivos"]
    assert len(gerados) == 4
    for arquivo in gerados:
        assert os.path.exists(arquivo["arquivo"]), "o caminho voltou, mas o arquivo nao esta la"
        assert ACENTUADO in os.path.basename(arquivo["arquivo"])


def test_a_resposta_sai_em_ascii_puro(pdf_acentuado):
    """A blindagem: a linha que sai nao depende de codificacao nenhuma.

    Com `ensure_ascii`, o proprio JSON escapa o que nao for ASCII. E o que
    garante que nenhum caractere — nem um substituto solto vindo de um nome
    estranho no disco — tenha como derrubar a escrita outra vez.
    """
    entrada = json.dumps({"id": "1", "acao": "informar", "arquivos": [str(pdf_acentuado)]}) + "\n"
    processo = subprocess.run(
        [sys.executable, PRINCIPAL],
        input=entrada.encode("utf-8"),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=120,
    )
    assert processo.stdout.isascii(), "saiu caractere fora do ASCII na linha do protocolo"
    # E, escapado, continua sendo o nome certo do outro lado.
    resposta = json.loads(processo.stdout.decode("ascii"))
    assert ACENTUADO in resposta["dados"]["arquivos"][0]["nome"]


def test_os_tres_canais_sao_reconfigurados():
    """Guarda contra alguem apagar uma das tres linhas.

    Nao substitui os testes de cima — sao eles que provam o comportamento, e
    quem apagar o `stdin` os ve falhar. Este aqui existe so para dizer, no
    lugar onde o erro aparece, que as tres linhas andam juntas: quem mexer no
    `principal.py` le o motivo antes de decidir que uma delas e sobra.
    """
    with open(PRINCIPAL, encoding="utf-8") as arquivo:
        fonte = arquivo.read()

    for canal in ("stdin", "stdout", "stderr"):
        assert f'sys.{canal}.reconfigure(encoding="utf-8"' in fonte, (
            f"o {canal} deixou de ser reconfigurado para UTF-8; "
            "no Windows ele volta para cp1252 e acento em nome de arquivo derruba o motor"
        )
