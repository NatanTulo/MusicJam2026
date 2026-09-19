"""Detekcja ludzi. Wymienne backendy za wspolnym interfejsem.

Dlaczego NanoDet-Plus-m-1.5x (416) jako domyslny:
  * 3.8 MB, ~1.5 GFLOPs - realne ~10-15 fps na 4 rdzeniach RPi5, bez akceleratora
  * COCO, wiec klasa 0 = person; bierzemy tylko ja
  * ONNX -> onnxruntime dziala tak samo na x86 i na aarch64

Jesli modelu nie ma na dysku, klasa HogDetector daje dzialajacy (slaby, ale
zerowo-zaleznosciowy) fallback, zeby dalo sie odpalic pipeline od razu.
"""
from __future__ import annotations

import os
from typing import List, Sequence

import cv2
import numpy as np

from .types import Detection

PERSON_CLASS_ID = 0  # COCO


def letterbox(img: np.ndarray, size: int) -> tuple[np.ndarray, float, int, int]:
    """Skaluje z zachowaniem proporcji i dopelnia do kwadratu size x size.

    Bez tego model dostaje rozciagnietych ludzi (kamera 16:9 -> wejscie 1:1),
    co wyraznie psuje recall przy osobach z boku kadru.
    """
    h, w = img.shape[:2]
    scale = min(size / w, size / h)
    nw, nh = int(round(w * scale)), int(round(h * scale))
    resized = cv2.resize(img, (nw, nh), interpolation=cv2.INTER_LINEAR)
    canvas = np.full((size, size, 3), 114, dtype=img.dtype)
    dx, dy = (size - nw) // 2, (size - nh) // 2
    canvas[dy : dy + nh, dx : dx + nw] = resized
    return canvas, scale, dx, dy


class Detector:
    name = "base"

    def detect(self, frame_bgr: np.ndarray) -> List[Detection]:
        raise NotImplementedError


class NanoDetONNX(Detector):
    name = "nanodet"

    INPUT_SIZE = 416
    STRIDES = (8, 16, 32)
    REG_MAX = 7
    MEAN = np.array([103.53, 116.28, 123.675], dtype=np.float32)
    STD = np.array([57.375, 57.12, 58.395], dtype=np.float32)

    def __init__(
        self,
        model_path: str,
        score_threshold: float = 0.35,
        iou_threshold: float = 0.6,
        num_threads: int = 4,
    ) -> None:
        import onnxruntime as ort

        if not os.path.isfile(model_path):
            raise FileNotFoundError(
                f"Brak modelu {model_path}. Uruchom: bash models/download_models.sh"
            )

        opts = ort.SessionOptions()
        opts.intra_op_num_threads = num_threads
        opts.inter_op_num_threads = 1
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        opts.log_severity_level = 3  # cisza; model ma nieszkodliwe ostrzezenia o initializerach

        self.session = ort.InferenceSession(model_path, opts, providers=["CPUExecutionProvider"])
        self.input_name = self.session.get_inputs()[0].name
        self.score_threshold = score_threshold
        self.iou_threshold = iou_threshold

        # Wyjscia modelu nie sa uporzadkowane; rozpoznajemy je po ksztalcie:
        #   (1, N, 80) -> klasy, (1, N, 32) -> regresja boxa (4 boki x 8 binow)
        outs = self.session.get_outputs()
        self._cls_names = [o.name for o in outs if o.shape[-1] == 80]
        self._reg_names = [o.name for o in outs if o.shape[-1] == self.REG_MAX * 4 + 4]
        shape_of = {o.name: o.shape for o in outs}
        self._cls_names.sort(key=lambda n: -shape_of[n][1])  # malejaca liczba punktow = stride rosnaco
        self._reg_names.sort(key=lambda n: -shape_of[n][1])
        self._output_names = self._cls_names + self._reg_names

        self._anchors = [self._make_anchors(s) for s in self.STRIDES]
        self._project = np.arange(self.REG_MAX + 1, dtype=np.float32)

    def _make_anchors(self, stride: int) -> np.ndarray:
        n = self.INPUT_SIZE // stride
        shift = np.arange(n, dtype=np.float32) * stride + 0.5 * (stride - 1)
        xv, yv = np.meshgrid(shift, shift)
        return np.column_stack((xv.ravel(), yv.ravel()))

    def detect(self, frame_bgr: np.ndarray) -> List[Detection]:
        h, w = frame_bgr.shape[:2]
        padded, scale, dx, dy = letterbox(frame_bgr, self.INPUT_SIZE)

        blob = (padded.astype(np.float32) - self.MEAN) / self.STD
        blob = blob.transpose(2, 0, 1)[None]  # NCHW, kanaly BGR (tak byl trenowany)

        outputs = self.session.run(self._output_names, {self.input_name: blob})
        n_lvl = len(self._cls_names)
        cls_outs, reg_outs = outputs[:n_lvl], outputs[n_lvl:]

        boxes: list[np.ndarray] = []
        scores: list[np.ndarray] = []
        for stride, anchors, cls, reg in zip(self.STRIDES, self._anchors, cls_outs, reg_outs):
            cls = cls[0]  # (N, 80)
            reg = reg[0]  # (N, 32)

            person = cls[:, PERSON_CLASS_ID]
            keep = person > self.score_threshold
            if not keep.any():
                continue
            person = person[keep]
            reg = reg[keep]
            pts = anchors[keep]

            # Distribution Focal Loss: kazdy bok to softmax po 8 binach -> wartosc oczekiwana
            dist = reg.reshape(-1, 4, self.REG_MAX + 1)
            dist = np.exp(dist - dist.max(axis=2, keepdims=True))
            dist /= dist.sum(axis=2, keepdims=True)
            dist = (dist @ self._project) * stride  # (M, 4) = odleglosci l, t, r, b

            xyxy = np.empty((pts.shape[0], 4), dtype=np.float32)
            xyxy[:, 0] = pts[:, 0] - dist[:, 0]
            xyxy[:, 1] = pts[:, 1] - dist[:, 1]
            xyxy[:, 2] = pts[:, 0] + dist[:, 2]
            xyxy[:, 3] = pts[:, 1] + dist[:, 3]
            boxes.append(xyxy)
            scores.append(person)

        if not boxes:
            return []

        xyxy = np.concatenate(boxes)
        conf = np.concatenate(scores)

        wh = np.column_stack([xyxy[:, 0], xyxy[:, 1], xyxy[:, 2] - xyxy[:, 0], xyxy[:, 3] - xyxy[:, 1]])
        idx = cv2.dnn.NMSBoxes(wh.tolist(), conf.tolist(), self.score_threshold, self.iou_threshold)
        if len(idx) == 0:
            return []
        idx = np.asarray(idx).reshape(-1)

        # cofniecie letterboxa -> piksele oryginalu -> normalizacja do [0, 1]
        out: list[Detection] = []
        for i in idx:
            x1, y1, x2, y2 = xyxy[i]
            x1 = (x1 - dx) / scale / w
            x2 = (x2 - dx) / scale / w
            y1 = (y1 - dy) / scale / h
            y2 = (y2 - dy) / scale / h
            out.append(
                Detection(
                    float(np.clip(x1, 0, 1)),
                    float(np.clip(y1, 0, 1)),
                    float(np.clip(x2, 0, 1)),
                    float(np.clip(y2, 0, 1)),
                    float(conf[i]),
                )
            )
        return out


class HogDetector(Detector):
    """Fallback bez zadnego pliku modelu (OpenCV ma wagi HOG+SVM w srodku).

    Jakosc duzo gorsza niz NanoDet i wolniejszy przy wiekszych klatkach -
    sluzy tylko do tego, zeby pipeline dalo sie odpalic bez pobierania modeli.
    """

    name = "hog"

    def __init__(self, score_threshold: float = 0.3, detect_width: int = 320) -> None:
        self.hog = cv2.HOGDescriptor()
        self.hog.setSVMDetector(cv2.HOGDescriptor_getDefaultPeopleDetector())
        self.score_threshold = score_threshold
        self.detect_width = detect_width

    def detect(self, frame_bgr: np.ndarray) -> List[Detection]:
        h, w = frame_bgr.shape[:2]
        scale = self.detect_width / w
        small = cv2.resize(frame_bgr, (self.detect_width, int(h * scale)))
        rects, weights = self.hog.detectMultiScale(
            small, winStride=(8, 8), padding=(8, 8), scale=1.05
        )
        out: list[Detection] = []
        for (x, y, rw, rh), score in zip(rects, np.asarray(weights).reshape(-1)):
            if score < self.score_threshold:
                continue
            out.append(
                Detection(
                    float(np.clip(x / small.shape[1], 0, 1)),
                    float(np.clip(y / small.shape[0], 0, 1)),
                    float(np.clip((x + rw) / small.shape[1], 0, 1)),
                    float(np.clip((y + rh) / small.shape[0], 0, 1)),
                    float(min(1.0, score / 2.0)),
                )
            )
        return out


def build_detector(
    kind: str,
    model_path: str,
    score_threshold: float,
    iou_threshold: float,
    num_threads: int,
) -> Detector:
    if kind == "hog":
        return HogDetector(score_threshold)
    if kind in ("nanodet", "auto"):
        try:
            return NanoDetONNX(model_path, score_threshold, iou_threshold, num_threads)
        except (FileNotFoundError, ImportError) as exc:
            if kind == "nanodet":
                raise
            print(f"[detector] NanoDet niedostepny ({exc}); przechodze na HOG.")
            return HogDetector(score_threshold)
    raise ValueError(f"Nieznany detektor: {kind}")
