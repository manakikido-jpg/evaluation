"""軌跡の予告と告知の独自音。既存の曲/録音を使わず、固定波形から合成する。"""
from pathlib import Path
import subprocess
import tempfile
import wave
import numpy as np

RATE = 44100
DEST = Path(__file__).resolve().parents[2] / 'src/web/public/kiseki-media'


def tone(y, frequency, start, length, level, metallic=False):
    begin = int(start * RATE)
    count = min(int(length * RATE), len(y) - begin)
    t = np.arange(count) / RATE
    env = np.minimum(t / .012, 1) * np.exp(-t * 5 / length)
    env *= np.minimum((length - t) / .04, 1)
    value = np.sin(2 * np.pi * frequency * t)
    value += .25 * np.sin(2 * np.pi * frequency * (2.76 if metallic else 2) * t)
    y[begin:begin + count] += value * env * level


def build(name):
    duration = {'wind': .85, 'glint': .9, 'thunder': 1.05, 'gates': 1.15,
                'win-gg': 2.4, 'win-god': 3.8, 'win-sgg': 2.8}[name]
    t = np.arange(int(duration * RATE)) / RATE
    y = np.zeros_like(t)
    rng = np.random.default_rng(110700 + list(NAMES).index(name))
    noise = rng.normal(0, 1, len(t))
    # 高音だけのノイズを避け、風や低い響きへ帯域を分ける。
    soft = np.convolve(noise, np.ones(41) / 41, mode='same')
    low = np.convolve(noise, np.ones(241) / 241, mode='same')
    if name == 'wind':
        y += soft * np.sin(np.pi * t / duration) ** 2 * .85
        tone(y, 740, .12, .62, .08)
    elif name == 'glint':
        for i, f in enumerate([880, 1320, 1760]):
            tone(y, f, i * .075, .65, .12, True)
    elif name == 'thunder':
        y += low * np.exp(-t * 4) * 3.5
        y += soft * np.exp(-t * 25) * .6
        tone(y, 62, 0, .9, .2)
        tone(y, 93, .025, .75, .12)
    elif name == 'gates':
        y += low * np.sin(np.pi * t / duration) ** 2 * 1.8
        tone(y, 98, 0, 1.1, .16, True)
        tone(y, 196, .05, 1, .1, True)
        tone(y, 784, .08, .75, .12, True)
    else:
        # 短い衝撃＋厚い金属音＋長い余韻。元の実機メロディは使用しない。
        y += low * np.exp(-t * 12) * 2
        tone(y, 65.4, 0, 1, .22)
        notes = {'win-gg': [392, 523.25, 784],
                 'win-god': [261.63, 392, 523.25, 784, 1046.5],
                 'win-sgg': [293.66, 440, 587.33, 880]}[name]
        for i, f in enumerate(notes):
            tone(y, f, .06 + i * .055, duration - .35, .18 / (1 + i * .12), True)
    # 小さな残響を左右へずらして奥行きを作る。乾いた音は中央に残す。
    stereo = np.stack([y.copy(), y.copy()], axis=1)
    for channel in range(2):
        for seconds, level in [(.073 + channel * .009, .15), (.147 - channel * .007, .08)]:
            delay = int(seconds * RATE)
            stereo[delay:, channel] += y[:-delay] * level
    fade = min(int(.025 * RATE), len(y) // 4)
    stereo[:fade] *= np.linspace(0, 1, fade)[:, None]
    stereo[-fade:] *= np.linspace(1, 0, fade)[:, None]
    stereo *= .68 / max(.68, float(np.max(np.abs(stereo))))
    target = DEST / (name + '.mp3' if name.startswith('win-') else 'cue-' + name + '.mp3')
    with tempfile.TemporaryDirectory(prefix='kiseki-direction-') as directory:
        source = Path(directory) / 'sound.wav'
        with wave.open(str(source), 'wb') as output:
            output.setnchannels(2)
            output.setsampwidth(2)
            output.setframerate(RATE)
            output.writeframes((stereo * 32767).astype('<i2').tobytes())
        subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(source),
                        '-codec:a', 'libmp3lame', '-b:a', '128k', str(target)], check=True)
    print(f'{target.name}: {duration:.2f}s, peak={np.max(np.abs(stereo)):.3f}')


def build_response(kind, ending):
    # 停止は短い打音、終了は低く減衰する音。開始音の再生速度変更だけにしない。
    duration = .55 if ending else .28
    t = np.arange(int(duration * RATE)) / RATE
    y = np.zeros_like(t)
    number = ['wind', 'glint', 'thunder', 'gates'].index(kind)
    rng = np.random.default_rng(110710 + number * 2 + int(ending))
    noise = rng.normal(0, 1, len(t))
    soft = np.convolve(noise, np.ones(41) / 41, mode='same')
    low = np.convolve(noise, np.ones(161) / 161, mode='same')
    frequency = [580, 1174.66, 73.42, 146.83][number] * (.75 if ending else 1)
    if kind == 'wind':
        y += soft * np.sin(np.pi * t / duration) ** 2 * .55
    elif kind == 'glint':
        tone(y, frequency * 1.5, .025, duration - .04, .07, True)
    else:
        y += low * np.exp(-t * (10 if ending else 24)) * 1.4
    tone(y, frequency, 0, duration - .015, .13, kind in ['glint', 'gates'])
    stereo = np.stack([y.copy(), y.copy()], axis=1)
    for channel in range(2):
        delay = int((.047 + channel * .011) * RATE)
        stereo[delay:, channel] += y[:-delay] * .12
    fade = int(.012 * RATE)
    stereo[:fade] *= np.linspace(0, 1, fade)[:, None]
    stereo[-fade:] *= np.linspace(1, 0, fade)[:, None]
    target = DEST / ('cue-' + kind + ('-end' if ending else '-stop') + '.mp3')
    with tempfile.TemporaryDirectory(prefix='kiseki-response-') as directory:
        source = Path(directory) / 'sound.wav'
        with wave.open(str(source), 'wb') as output:
            output.setnchannels(2)
            output.setsampwidth(2)
            output.setframerate(RATE)
            output.writeframes((stereo * 32767).astype('<i2').tobytes())
        subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(source),
                        '-codec:a', 'libmp3lame', '-b:a', '128k', str(target)], check=True)
    print(f'{target.name}: {duration:.2f}s, peak={np.max(np.abs(stereo)):.3f}')


NAMES = ['wind', 'glint', 'thunder', 'gates', 'win-gg', 'win-god', 'win-sgg']
if __name__ == '__main__':
    import sys
    if '--responses-only' not in sys.argv:
        for sound in NAMES:
            build(sound)
    for kind in ['wind', 'glint', 'thunder', 'gates']:
        for ending in [False, True]:
            build_response(kind, ending)
