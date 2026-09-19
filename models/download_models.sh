#!/usr/bin/env bash
# Pobiera modele detekcji (nie trzymamy ich w gicie).
set -euo pipefail
cd "$(dirname "$0")"

ZOO="https://github.com/opencv/opencv_zoo/raw/main/models"

echo "[1/2] NanoDet-Plus-m-1.5x 416 (3.8 MB) - domyslny, szybki, pod RPi5"
curl -fL --progress-bar -o nanodet-plus-m-1.5x-416.onnx \
  "$ZOO/object_detection_nanodet/object_detection_nanodet_2022nov.onnx"

if [ "${WITH_YOLOX:-0}" = "1" ]; then
  echo "[2/2] YOLOX-S 640 (35 MB) - dokladniejszy, wolny na RPi5"
  curl -fL --progress-bar -o yolox_s-640.onnx \
    "$ZOO/object_detection_yolox/object_detection_yolox_2022nov.onnx"
else
  echo "[2/2] YOLOX-S pominiety (WITH_YOLOX=1 zeby pobrac)"
fi
echo "Gotowe."
