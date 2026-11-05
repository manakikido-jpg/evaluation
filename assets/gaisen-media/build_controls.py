"""レバー/STOPだけを磨く独自の物理モデル合成。実機の録音は使わない。
実行: python3 assets/gaisen-media/build_controls.py
既存の当選音・回転音・画像は再生成しない。manifestも4音だけ更新する。
"""
from pathlib import Path
import hashlib
import json
import subprocess
import tempfile
import numpy as np
from scipy import signal
from scipy.io import wavfile

SR = 44100
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'src/web/public/gaisen-media'
MANIFEST = Path(__file__).with_name('manifest.json')


def pulse(t, rng, frequency, decay=.026, hardness=1):
    noise = signal.sosfilt(signal.butter(2, [900, 9000], btype='bandpass', fs=SR, output='sos'), rng.normal(0, 1, len(t)))
    snap = noise * np.exp(-t / .0038) * .4 * hardness
    # 樹脂の低い胴鳴りと、小さい金属板の非整数倍の共鳴。
    body = np.sin(2 * np.pi * (112 * t + .6 * (1 - np.exp(-t * 90)))) * np.exp(-t / .018) * .2
    metal = sum(a * np.sin(2 * np.pi * frequency * ratio * t) * np.exp(-t / (decay / damping))
                for ratio, a, damping in [(1, .24, 1), (2.63, .12, 1.8), (5.17, .045, 2.8)])
    return snap + body + metal


def make(name, index):
    rng = np.random.default_rng(20261105 + index)
    lever = name == 'lever'
    t = np.arange(round(SR * (.31 if lever else .18))) / SR
    mono = pulse(t, rng, 178 if lever else 360 + index * 21, .038 if lever else .023, .75 if lever else 1)
    # レバーは短い摺動→ラッチ、STOPは押し切った後の小さい戻り。
    shift = .044 if lever else .022
    later = np.maximum(0, t - shift)
    mono += pulse(later, rng, 275 if lever else 190 + index * 13, .018, .65) * (t >= shift) * (.5 if lever else .15)
    if lever:
        spring = signal.sosfilt(signal.butter(2, [130, 1500], btype='bandpass', fs=SR, output='sos'), rng.normal(0, 1, len(t)))
        mono += spring * np.exp(-((t - .026) / .014) ** 2) * .055
    mono -= mono.mean()
    stereo = np.column_stack([mono, mono])
    # 筐体の中の近い反射だけ。長い室内残響は操作音に加えない。
    for channel, extra in [(0, 0), (1, .0015)]:
        for delay, level in [(.009, .09), (.017, .045)]:
            start = round((delay + extra) * SR)
            stereo[start:, channel] += mono[:-start] * level
    stereo[:26] *= np.linspace(0, 1, 26)[:, None]
    fade = round(.012 * SR)
    stereo[-fade:] *= np.linspace(1, 0, fade)[:, None]
    stereo *= (.64 if lever else .58) / max(np.abs(stereo).max(), .001)
    assert np.isfinite(stereo).all() and np.abs(stereo).max() < .7
    return stereo


def main():
    manifest = json.loads(MANIFEST.read_text())
    names = ['lever', 'stop-left', 'stop-middle', 'stop-right']
    for index, name in enumerate(names):
        stereo = make(name, index)
        output = OUT / f'{name}.mp3'
        with tempfile.TemporaryDirectory() as directory:
            master = Path(directory) / 'master.wav'
            wavfile.write(master, SR, (stereo * 32767).astype(np.int16))
            subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(master), '-codec:a', 'libmp3lame', '-b:a', '128k', '-write_xing', '1', str(output)], check=True)
        metadata = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(output)]))
        decoded = np.frombuffer(subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(output), '-f', 'f32le', '-acodec', 'pcm_f32le', '-']), dtype='<f4')
        peak = float(np.abs(decoded).max())
        assert np.isfinite(decoded).all() and 0 < peak < .8
        entry = next(item for item in manifest['files'] if item['file'] == output.name)
        entry.update(bytes=output.stat().st_size, sha256=hashlib.sha256(output.read_bytes()).hexdigest(), duration=float(metadata['format']['duration']), sampleRate=int(metadata['streams'][0]['sample_rate']), channels=metadata['streams'][0]['channels'], decodedPeak=round(peak, 5), rmsDbFS=round(float(20 * np.log10(np.sqrt(np.mean(decoded ** 2)))), 2))
        print(f'{name}: {entry["duration"]:.3f}s, decoded peak {peak:.3f}')
    manifest['audioMethod'] = '独自の物理モデル合成。基本音はbuild_audio.py、回転音はbuild_motor.py、操作4音はbuild_controls.pyで短い衝撃/樹脂の胴鳴り/ばね/ラッチ/近い反射へ調整。録音・音声生成AIではない。'
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')


if __name__ == '__main__':
    main()
