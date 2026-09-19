"""Ustawienia zmieniane najczesciej - w jednym miejscu.

Wszystkie skrypty (app.py, serve.py, tools/) biora stad wartosci domyslne;
flagi z linii polecen (--camera, --mirror) nadal je nadpisuja.
"""
from __future__ import annotations

import os

# ---------------------------------------------------------------------------
# ZRODLO OBRAZU  <-- tu przelaczasz nagranie testowe <-> prawdziwa kamere
# ---------------------------------------------------------------------------
#   "media/vtest.avi"  nagranie testowe (domyslnie, dopoki nie ma kamery;
#                      pobierz: bash media/download_sample_video.sh)
#   0                  kamera USB / wbudowana w laptopa
#   "picam"            kamera CSI na Raspberry Pi 5
#   "cokolwiek.mp4"    dowolny inny plik wideo (petla)
SOURCE: int | str = "media/vtest.avi"

# Lustro: dla kamery patrzacej na ludzi True (ruch w prawo = ryba w prawo),
# dla nagrania z boku/z gory zwykle False.
MIRROR: bool = False

# Port mostka detekcja -> przegladarka (serve.py). Strona web laczy sie z
# http://<host>:BRIDGE_PORT/fish
BRIDGE_PORT: int = 8765

_HERE = os.path.dirname(os.path.abspath(__file__))


def resolve_source(source: int | str) -> int | str:
    """Sciezki wzgledne licz od folderu people_detection, nie od biezacego katalogu."""
    if isinstance(source, int) or str(source).isdigit() or source == "picam":
        return source
    if os.path.isabs(source) or os.path.exists(source):
        return source
    candidate = os.path.join(_HERE, source)
    return candidate if os.path.exists(candidate) else source
