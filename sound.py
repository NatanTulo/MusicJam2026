import subprocess
import threading
import queue
import time
import glob
import numpy as np
import serial
import customtkinter as ctk

# ============ LOGIKA AUDIO / UART ============

SR    = 48000
BLOCK = 2048
BAUD  = 115200

def list_serial_ports():
    """Zwraca listę portów z /dev/ttyACM* i /dev/ttyUSB*."""
    ports = []
    for pattern in ("/dev/ttyACM*", "/dev/ttyUSB*"):
        ports.extend(glob.glob(pattern))
    return sorted(ports)

def list_audio_sources():
    try:
        out = subprocess.check_output(["pactl", "list", "sources", "short"]).decode()
    except Exception:
        return []
    sources = []
    for line in out.strip().splitlines():
        parts = line.split("\t")
        if len(parts) >= 2:
            name = parts[1]
            is_monitor = name.endswith(".monitor")
            label = ("[MONITOR] " if is_monitor else "[MIC]     ") + name
            sources.append((label, name))
    return sources


class AudioSender(threading.Thread):
    def __init__(self, serial_port, audio_source, ui_queue):
        super().__init__(daemon=True)
        self.serial_port  = serial_port
        self.audio_source = audio_source
        self.ui_queue     = ui_queue
        self._stop        = threading.Event()

    def stop(self):
        self._stop.set()

    def run(self):
        try:
            proc = subprocess.Popen(
                ["parec", "-d", self.audio_source, "--format=s16le",
                 "--rate=48000", "--channels=2", "--latency-msec=10"],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, bufsize=0
            )
            fd = proc.stdout.fileno()
            ser = serial.Serial(self.serial_port, BAUD, timeout=0)
        except Exception as e:
            self.ui_queue.put(("error", f"Błąd startu: {e}"))
            return

        bytes_per_block = BLOCK * 4
        buf = b""
        freqs = np.fft.rfftfreq(BLOCK, 1/SR)
        band_mask = (freqs >= 20) & (freqs <= 2000)

        self.ui_queue.put(("status", "Działa"))

        try:
            while not self._stop.is_set():
                chunk = proc.stdout.read(bytes_per_block)
                if not chunk:
                    break
                buf += chunk
                if len(buf) < bytes_per_block:
                    continue
                raw, buf = buf[:bytes_per_block], buf[bytes_per_block:]

                a = np.frombuffer(raw, dtype=np.int16).astype(np.float32) \
                      .reshape(-1, 2).mean(axis=1) / 32768.0

                rms = float(np.sqrt(np.mean(a**2)))
                amp = int(np.clip(rms * 800, 0, 255))

                win = a * np.hanning(len(a))
                fft = np.abs(np.fft.rfft(win))

                bass_mag = float(np.sqrt(np.mean(fft[1:7] ** 2)))
                bass = int(np.clip(bass_mag / 0.22, 0, 255))

                fft_band = fft * band_mask
                peak = int(np.argmax(fft_band))
                freq = int(np.clip(freqs[peak], 0, 2000))

                pkt = bytes([0xAA, amp, bass, freq>>8, freq&0xFF, 0])
                ser.write(pkt[:5] + bytes([(pkt[1]+pkt[2]+pkt[3]+pkt[4]) & 0xFF]))

                self.ui_queue.put(("data", (amp, bass, freq)))

        except Exception as e:
            self.ui_queue.put(("error", str(e)))
        finally:
            try: ser.close()
            except: pass
            try: proc.terminate()
            except: pass
            self.ui_queue.put(("status", "Zatrzymano"))


# ============ GUI ============

class App(ctk.CTk):
    def __init__(self):
        super().__init__()
        self.title("Audio → ESP32 (WS2812B + Serwa)")
        self.geometry("560x420")
        ctk.set_appearance_mode("dark")

        self.sender = None
        self.ui_queue = queue.Queue()
        self.audio_list = []

        # --- Porty USB ---
        ctk.CTkLabel(self, text="Port USB (ESP32):", anchor="w") \
            .pack(fill="x", padx=15, pady=(15, 2))
        row1 = ctk.CTkFrame(self, fg_color="transparent")
        row1.pack(fill="x", padx=15)
        self.combo_serial = ctk.CTkComboBox(row1, values=[""], width=380)
        self.combo_serial.pack(side="left", fill="x", expand=True)
        ctk.CTkButton(row1, text="Odśwież", width=90,
                      command=self.refresh_serial).pack(side="left", padx=(8, 0))

        # --- Źródło audio ---
        ctk.CTkLabel(self, text="Źródło audio:", anchor="w") \
            .pack(fill="x", padx=15, pady=(15, 2))
        row2 = ctk.CTkFrame(self, fg_color="transparent")
        row2.pack(fill="x", padx=15)
        self.combo_audio = ctk.CTkComboBox(row2, values=[""], width=380)
        self.combo_audio.pack(side="left", fill="x", expand=True)
        ctk.CTkButton(row2, text="Odśwież", width=90,
                      command=self.refresh_audio).pack(side="left", padx=(8, 0))

        # --- Start/Stop ---
        row3 = ctk.CTkFrame(self, fg_color="transparent")
        row3.pack(fill="x", padx=15, pady=15)
        self.btn_start = ctk.CTkButton(row3, text="START", fg_color="green",
                                       hover_color="darkgreen",
                                       command=self.start)
        self.btn_start.pack(side="left", expand=True, fill="x", padx=(0, 5))
        self.btn_stop = ctk.CTkButton(row3, text="STOP", fg_color="darkred",
                                      hover_color="red", state="disabled",
                                      command=self.stop)
        self.btn_stop.pack(side="left", expand=True, fill="x", padx=(5, 0))

        # --- Status ---
        self.lbl_status = ctk.CTkLabel(self, text="Zatrzymano",
                                       font=("Arial", 14, "bold"))
        self.lbl_status.pack(pady=(0, 10))

        # --- Odczyt ---
        frame_data = ctk.CTkFrame(self)
        frame_data.pack(fill="both", expand=True, padx=15, pady=(0, 15))

        self.lbl_amp = ctk.CTkLabel(frame_data, text="AMP:   ---",
                                    font=("Courier", 22, "bold"))
        self.lbl_amp.pack(anchor="w", padx=15, pady=5)

        self.lbl_bass = ctk.CTkLabel(frame_data, text="BASS:  ---",
                                     font=("Courier", 22, "bold"))
        self.lbl_bass.pack(anchor="w", padx=15, pady=5)

        self.lbl_freq = ctk.CTkLabel(frame_data, text="FREQ:  ---",
                                     font=("Courier", 22, "bold"))
        self.lbl_freq.pack(anchor="w", padx=15, pady=5)

        self.refresh_serial()
        self.refresh_audio()
        self.after(50, self.poll_queue)

    def refresh_serial(self):
        ports = list_serial_ports()
        if ports:
            self.combo_serial.configure(values=ports)
            self.combo_serial.set(ports[0])
        else:
            self.combo_serial.configure(values=["(brak)"])
            self.combo_serial.set("(brak)")

    def refresh_audio(self):
        srcs = list_audio_sources()
        self.audio_list = [s[1] for s in srcs]
        labels = [s[0] for s in srcs]
        if labels:
            self.combo_audio.configure(values=labels)
            idx = next((i for i, l in enumerate(labels) if l.startswith("[MONITOR]")), 0)
            self.combo_audio.set(labels[idx])
        else:
            self.combo_audio.configure(values=["(brak)"])
            self.combo_audio.set("(brak)")

    def start(self):
        port  = self.combo_serial.get()
        audio = self.combo_audio.get()

        if port in ("(brak)", "") or audio in ("(brak)", ""):
            self.lbl_status.configure(text="Wybierz port i źródło audio")
            return

        try:
            idx = self.combo_audio.cget("values").index(audio)
            audio_name = self.audio_list[idx]
        except Exception:
            audio_name = audio

        self.sender = AudioSender(port, audio_name, self.ui_queue)
        self.sender.start()

        self.btn_start.configure(state="disabled")
        self.btn_stop.configure(state="normal")
        self.lbl_status.configure(text="Uruchamianie...")

    def stop(self):
        if self.sender:
            self.sender.stop()
            self.sender = None
        self.btn_start.configure(state="normal")
        self.btn_stop.configure(state="disabled")
        self.lbl_status.configure(text="Zatrzymano")
        self.lbl_amp.configure(text="AMP:   ---")
        self.lbl_bass.configure(text="BASS:  ---")
        self.lbl_freq.configure(text="FREQ:  ---")

    def poll_queue(self):
        try:
            while True:
                kind, payload = self.ui_queue.get_nowait()
                if kind == "data":
                    amp, bass, freq = payload
                    self.lbl_amp.configure(text=f"AMP:   {amp:3d}")
                    self.lbl_bass.configure(text=f"BASS:  {bass:3d}")
                    self.lbl_freq.configure(text=f"FREQ:  {freq:5d} Hz")
                elif kind == "status":
                    self.lbl_status.configure(text=payload)
                elif kind == "error":
                    self.lbl_status.configure(text=f"Błąd: {payload}")
                    self.btn_start.configure(state="normal")
                    self.btn_stop.configure(state="disabled")
        except queue.Empty:
            pass
        self.after(50, self.poll_queue)


if __name__ == "__main__":
    App().mainloop()