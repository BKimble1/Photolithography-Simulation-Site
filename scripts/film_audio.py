"""Assemble the film's narration for a stretch of film time (for recordings).

Places each segment's MP3 at its start time on the film timeline (the gaps between segments
are silence, exactly as in the app) and writes the requested range as a mono 24 kHz WAV.
Usage: film_audio.py <film.json> <out.wav>   (film.json is written by scripts/record.mjs)
"""
import json
import subprocess
import sys
import wave

import imageio_ffmpeg
import numpy as np

SR = 24000
spec = json.load(open(sys.argv[1]))
start, dur = spec["from"], spec["dur"]
out = np.zeros(int(round(dur * SR)), dtype=np.float32)
ff = imageio_ffmpeg.get_ffmpeg_exe()
for seg in spec["segments"]:
    pcm = subprocess.run([ff, "-loglevel", "error", "-i", spec["dir"] + seg["file"], "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"], capture_output=True, check=True).stdout
    a = np.frombuffer(pcm, dtype=np.float32)
    off = int(round((seg["start"] - start) * SR))
    lo, hi = max(0, off), min(len(out), off + len(a))
    if hi > lo:
        out[lo:hi] += a[lo - off : hi - off]
with wave.open(sys.argv[2], "wb") as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((np.clip(out, -1, 1) * 32767).astype("<i2").tobytes())
