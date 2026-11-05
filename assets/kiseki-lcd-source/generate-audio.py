"""軌跡専用の独自作曲。録音/既存曲を使わず、和音・倍音・打音から生成する。
python3 assets/kiseki-lcd-source/generate-audio.py
依存: numpy / ffmpeg（制作時だけ）。配信は生成したMP3のみ。
"""
from pathlib import Path
import subprocess
import tempfile
import wave
import numpy as np

RATE = 44100
DEST = Path(__file__).resolve().parents[2] / 'src/web/public/kiseki-media'


def render(theme, bpm, root, major=False, fanfare=False):
    beat = 60 / bpm
    length = 4 * beat if fanfare else 32 * beat
    out = np.zeros((int((length + (1 if fanfare else 0)) * RATE), 2))
    rng = np.random.default_rng(508 + root)

    def voice(midi, at, seconds, level, bell=False, pan=0):
        size = min(int(seconds * RATE), len(out) - int(at * RATE))
        if size <= 0:
            return
        t = np.arange(size) / RATE
        f = 440 * 2 ** ((midi - 69) / 12)
        if bell:
            y = sum(np.sin(2 * np.pi * f * h * t) * np.exp(-t * (1.7 + j)) / (j + 1) ** 1.6
                    for j, h in enumerate([1, 2.001, 3.99, 5.008]))
            env = np.minimum(t / .008, 1) * np.minimum((seconds - t) / .08, 1)
        else:
            y = sum(np.sin(2 * np.pi * f * h * t + .012 * np.sin(2 * np.pi * .7 * t)) / h ** 1.8
                    for h in range(1, 6))
            env = np.minimum(t / .09, 1) * np.minimum((seconds - t) / .25, 1)
        y *= np.maximum(env, 0) * level
        start = int(at * RATE)
        out[start:start + size, 0] += y * np.sqrt((1 - pan) / 2)
        out[start:start + size, 1] += y * np.sqrt((1 + pan) / 2)

    third = 4 if major else 3
    chords = [[0, third, 7, 14], [-3, 0, 4, 9], [-5, 0, third, 7], [-2, 2, 5, 9]]
    if fanfare:
        for j, note in enumerate([0, 7, 12, 12 + third, 19]):
            voice(root + note, j * beat / 2, 1.5 * beat, .16, True, (j - 2) / 5)
        for note in chords[0]:
            voice(root + note, 2 * beat, 2 * beat, .15)
    else:
        for bar in range(8):
            chord = chords[bar % 4]
            for j, note in enumerate(chord):
                voice(root + note, bar * 4 * beat, 4 * beat, .075, False, (j - 1.5) / 3)
            for n in range(8):
                note = chord[(n + bar) % 4] + (12 if n % 3 else 0)
                voice(root + note, (bar * 4 + n / 2) * beat, beat * 1.4,
                      .055 if theme == 'sgg' else .04, True, -.45 if n % 2 else .45)
            for n in range(4):
                at = (bar * 4 + n) * beat
                voice(root - 24 + chord[0], at, beat * .8, .13)
                if theme == 'sgg':
                    size = min(int(.2 * RATE), len(out) - int(at * RATE))
                    t = np.arange(size) / RATE
                    kick = np.sin(2 * np.pi * (45 * t + 1.3 * (1 - np.exp(-t * 30)))) * np.exp(-t * 28) * .12
                    out[int(at * RATE):int(at * RATE) + size] += kick[:, None]
                    hat = rng.normal(0, .012, size) * np.exp(-t * 90)
                    out[int(at * RATE):int(at * RATE) + size] += hat[:, None]
    # 両端をゼロへ収め、ループ時の段差/クリッピングを防ぐ。
    fade = min(int(.045 * RATE), len(out) // 2)
    out[:fade] *= np.linspace(0, 1, fade)[:, None]
    out[-fade:] *= np.linspace(1, 0, fade)[:, None]
    out = np.tanh(out * 1.3)
    peak = np.max(np.abs(out))
    out *= .74 / max(peak, .74)
    return (out * 32767).astype('<i2')


for theme, bpm, root, major in [('gg', 100, 62, False), ('pgg', 80, 62, True), ('sgg', 128, 66, False)]:
    for fanfare in [False, True]:
        key = {'gg': 'gg', 'pgg': 'god', 'sgg': 'sgg'}[theme] if fanfare else 'bgm-' + theme
        pcm = render(theme, bpm, root, major, fanfare)
        with tempfile.TemporaryDirectory() as temp:
            wav = Path(temp) / 'source.wav'
            with wave.open(str(wav), 'wb') as f:
                f.setnchannels(2)
                f.setsampwidth(2)
                f.setframerate(RATE)
                f.writeframes(pcm.tobytes())
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(wav), '-codec:a', 'libmp3lame',
                            '-b:a', '128k', '-map_metadata', '-1', str(DEST / (key + '.mp3'))], check=True)
        print(key, round(len(pcm) / RATE, 2), 'seconds')
