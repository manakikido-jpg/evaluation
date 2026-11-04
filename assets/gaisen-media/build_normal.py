"""通常時の風・遠雷・光の独自合成音。録音や生成AIは使わない。"""
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


def main():
    manifest = json.loads(MANIFEST.read_text())
    for index, name in enumerate(['cue-wind', 'cue-thunder', 'cue-glint']):
        rng = np.random.default_rng(2026110510 + index)
        t = np.arange(round(SR * [.68, .72, .52][index])) / SR
        noise = rng.normal(0, 1, len(t))
        band = [250, 1800] if index == 0 else [55, 650]
        air = signal.sosfilt(signal.butter(3, band, btype='bandpass', fs=SR, output='sos'), noise)
        envelope = np.sin(np.pi * np.arange(len(t)) / (len(t) - 1)) ** 2
        if index == 0:
            mono = air * envelope
        elif index == 1:
            # 雷の破裂音を避け、遠い低い一度のうなりにする。
            mono = (air + .08 * np.sin(2 * np.pi * (82 * t - 12 * t * t))) * envelope * np.exp(-t * 2)
        else:
            mono = sum(a * np.sin(2 * np.pi * f * t) * np.exp(-t * decay)
                       for f, a, decay in [(660, .6, 8), (990, .2, 12), (1485, .1, 15)])
            mono *= np.minimum(1, t / .018) * np.minimum(1, (t[-1] - t) / .03)
        stereo = np.column_stack([mono, mono])
        delay = round(.006 * SR)
        stereo[delay:, 1] += mono[:-delay] * .12
        stereo *= .45 / max(float(np.abs(stereo).max()), .001)
        output = OUT / f'{name}.mp3'
        with tempfile.TemporaryDirectory() as directory:
            master = Path(directory) / 'master.wav'
            wavfile.write(master, SR, (stereo * 32767).astype(np.int16))
            subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(master), '-codec:a', 'libmp3lame', '-b:a', '128k', '-write_xing', '1', str(output)], check=True)
        meta = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(output)]))
        decoded = np.frombuffer(subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(output), '-f', 'f32le', '-acodec', 'pcm_f32le', '-']), dtype='<f4')
        peak = float(np.abs(decoded).max())
        assert np.isfinite(decoded).all() and 0 < peak < .8
        item = dict(file=output.name, bytes=output.stat().st_size, sha256=hashlib.sha256(output.read_bytes()).hexdigest(), duration=float(meta['format']['duration']), sampleRate=int(meta['streams'][0]['sample_rate']), channels=meta['streams'][0]['channels'], decodedPeak=round(peak, 5), rmsDbFS=round(float(20 * np.log10(np.sqrt(np.mean(decoded ** 2)))), 2))
        manifest['files'] = [x for x in manifest['files'] if x['file'] != output.name] + [item]
        print(f'{name}: {item["duration"]:.3f}s, decoded peak {peak:.3f}')
    if 'build_normal.py' not in manifest['audioMethod']:
        manifest['audioMethod'] += ' 通常時の風/遠雷/光の3音はbuild_normal.pyで別合成。'
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')


if __name__ == '__main__':
    main()
