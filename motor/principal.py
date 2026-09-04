"""Entrada do motor.

Roda como processo filho do aplicativo, lendo pedidos do stdin ate a entrada
fechar. Quando o aplicativo morre, o stdin fecha e o motor sai sozinho, sem
deixar processo orfao.
"""

from __future__ import annotations

import os
import sys

# O Python embutivel nao poe a pasta do script no caminho de importacao, ao
# contrario do Python instalado. Sem esta linha o motor so funcionaria se
# alguem rodasse de dentro da pasta certa.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from motor.operacoes import ACOES  # noqa: E402
from motor.protocolo import atender  # noqa: E402


def principal() -> int:
    # O canal e JSON puro, entao qualquer print solto de biblioteca estragaria
    # a linha. Reconfigurar para UTF-8 evita que acento em nome de arquivo
    # quebre no console do Windows.
    sys.stdout.reconfigure(encoding="utf-8", newline="\n")
    sys.stderr.reconfigure(encoding="utf-8")

    if "--acoes" in sys.argv:
        print(" ".join(sorted(ACOES)))
        return 0

    atender(sys.stdin, ACOES)
    return 0


if __name__ == "__main__":
    raise SystemExit(principal())
