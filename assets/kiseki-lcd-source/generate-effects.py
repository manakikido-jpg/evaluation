"""軌跡の独自操作/払出し音。numpyとffmpegで生成し、既存録音は使わない。"""
from pathlib import Path
import subprocess
import tempfile
import wave
import numpy as np

RATE = 44100
DEST = Path(__file__).resolve().parents[2] / 'src/web/public/kiseki-media'
SOUNDS = {
    'contact': (.055, [145, 890], .8),
    'brake': (.16, [110, 240], .65),
    'nav': (.23, [880, 1320], .15),
    'tenpai': (.5, [660, 990, 1320], .12),
    'rare-stop': (.65, [392, 587.33, 784, 1174.66], .08),
    'payout-tick': (.065, [1850, 2800], .3),
    'phase-end': (.8, [523.25, 392, 261.63], .08),
    'phase-enter': (.8, [392, 523.25, 784, 1046.5], .08),
}

for index, (name, (length, tones, noise)) in enumerate(SOUNDS.items()):
    t = np.arange(int(length * RATE)) / RATE
    rng = np.random.default_rng(1126 + index)
    y = np.zeros_like(t)
    for j, frequency in enumerate(tones):
        at = 0 if name in ['contact', 'brake', 'payout-tick'] else j * length / (len(tones) * 2)
        u = np.maximum(0, t - at)
        envelope = (t >= at) * np.minimum(u / .004, 1) * np.exp(-u * (9 / length))
        chirp = frequency * u * (1 - (.15 if name == 'brake' else 0) * u / length)
        y += np.sin(2 * np.pi * chirp) * envelope / (j + 1) ** .6
    y += rng.normal(0, noise, len(t)) * np.exp(-t * 45)
    fade = min(150, len(t) // 4)
    y[:fade] *= np.linspace(0, 1, fade)
    y[-fade:] *= np.linspace(1, 0, fade)
    y *= .62 / max(np.max(np.abs(y)), .62)
    stereo = np.stack([y, y * .94], axis=1)
    pcm = (stereo * 32767).astype('<i2')
    with tempfile.TemporaryDirectory(prefix='kiseki-effect-') as directory:
        source = Path(directory) / 'effect.wav'
        with wave.open(str(source), 'wb') as output:
            output.setnchannels(2)
            output.setsampwidth(2)
            output.setframerate(RATE)
            output.writeframes(pcm.tobytes())
        subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(source),
                        '-codec:a', 'libmp3lame', '-b:a', '128k', str(DEST / f'fx-{name}.mp3')], check=True)
    print(f'{name}: {length:.3f}s / peak={np.max(np.abs(y)):.3f}')
