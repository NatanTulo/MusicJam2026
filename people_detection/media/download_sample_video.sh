#!/usr/bin/env bash
# Nagranie testowe zamiast kamery: ludzie chodzacy po placu (OpenCV samples, 8 MB).
# Nie trzymamy go w gicie - pobierz raz.
set -euo pipefail
cd "$(dirname "$0")"
curl -fL --progress-bar -o vtest.avi \
  "https://raw.githubusercontent.com/opencv/opencv/4.x/samples/data/vtest.avi"
echo "Gotowe: media/vtest.avi"
