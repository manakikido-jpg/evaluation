"""神殿スロットの独自音源。録音や実機の音源は使わない。
Python 3 / numpy / scipy / ffmpeg。乱数を固定して音の構成を再現する。
機械の打撃・共鳴・モーターと、金属/鐘の倍音・短い室内残響を重ねる。
実行: python3 assets/gaisen-media/build_audio.py
"""
from pathlib import Path
import subprocess
import tempfile
import numpy as np
from scipy import signal
from scipy.io import wavfile

SR = 44100
OUT = Path(__file__).resolve().parents[2] / 'src/web/public/gaisen-media'
RNG = np.random.default_rng(20261103)

def timeline(seconds):
    return np.arange(round(seconds * SR)) / SR

def resonance(t, frequency, decay, strength=1):
    # 金属板の非整数倍の共鳴。各モードの減衰も変える。
    return sum(strength * a * np.sin(2*np.pi*frequency*r*t) * np.exp(-t/(decay/d))
               for r,a,d in [(1,.7,1),(2.756,.28,1.7),(5.404,.15,2.5),(8.93,.06,3.5)])

def impact(seconds, base=220, hardness=1):
    t=timeline(seconds)
    noise=RNG.normal(0,1,len(t))
    noise=signal.sosfilt(signal.butter(2, [600,7500], btype='bandpass',fs=SR,output='sos'),noise)
    click=noise*np.exp(-t/(.005+.003/hardness))*.55*hardness
    body=resonance(t,base,.055,.55)+np.sin(2*np.pi*(65*t+12*(1-np.exp(-t*35))))*np.exp(-t/.028)*.45
    return click+body

def add(dst,src,when=0,gain=1):
    start=round(when*SR);end=min(len(dst),start+len(src))
    if end>start:dst[start:end]+=src[:end-start]*gain

def room(mono,decay=.25):
    # 左右で初期反射をずらす。遅い残響は耳につく高域を落とす。
    stereo=np.column_stack([mono,mono])
    low=signal.sosfilt(signal.butter(2,3500,fs=SR,output='sos'),mono)
    for channel,offset in [(0,0),(1,.007)]:
        for delay,level in [(.023,.19),(.047,.13),(.081,.10),(.129,.06),(.193,.035),(.293,.018)]:
            shift=round((delay+offset)*SR)
            if shift<len(mono):stereo[shift:,channel]+=low[:-shift]*level*decay/.25
    return stereo

def bell(seconds,note,strength=.7):
    t=timeline(seconds)
    a=resonance(t,note,.55,strength)
    # 打面と、低い基音を少量加える。
    a+=np.sin(2*np.pi*note*.5*t)*np.exp(-t/.38)*strength*.1
    a*=1-np.exp(-t/.002)
    return a

def flourish(seconds,notes,spacing=.16,deep=False):
    x=np.zeros(round(seconds*SR))
    for i,n in enumerate(notes):add(x,bell(min(1.5,seconds),n,.55),.06+i*spacing,1/(1+i*.06))
    if deep:
        t=timeline(seconds)
        x+=resonance(t,65.4,1.3,.4)*(1-np.exp(-t/.03))
        # 荘厳な低い胴鳴り。ノイズを低域に絞り、音声/声は含めない。
        wind=signal.sosfilt(signal.butter(2,280,fs=SR,output='sos'),RNG.normal(0,1,len(t)))
        x+=wind*np.exp(-t/.7)*.45
    return x

def create():
    sounds={}
    # 引き始め→ばね→奥でラッチが掛かる。単純な電子音にしない。
    t=timeline(.55);x=impact(.55,155,.7)
    x+=signal.sosfilt(signal.butter(2,[100,1300],btype='bandpass',fs=SR,output='sos'),RNG.normal(0,1,len(t)))*np.exp(-((t-.075)/.055)**2)*.09
    x+=np.sin(2*np.pi*(175*t+7*(1-np.exp(-t*28))))*np.exp(-t/.09)*.09
    add(x,impact(.22,310,.65),.135,.7);sounds['lever']=x
    for i,key in enumerate(['stop-left','stop-middle','stop-right']):
        x=impact(.28,330+i*32,.8);add(x,impact(.09,210+i*18,.45),.032,.22);sounds[key]=x
    x=np.zeros(round(1.25*SR))
    for i in range(8):add(x,bell(.45,1600+(i%3)*240,.35),i*.065,.4);add(x,impact(.13,1000+(i%2)*370,.8),i*.065,.15)
    sounds['payout']=x
    sounds['replay']=flourish(.9,[587.33,880],.14)
    sounds['phase']=flourish(1.4,[293.66,440,587.33],.12)
    sounds['medusa']=flourish(1.8,[440,554.37,880,1108.73],.19)
    sounds['ex']=flourish(1.8,[311.13,466.16,622.25,932.33],.12,True)
    sounds['gg']=flourish(2.8,[261.63,329.63,392,523.25,659.25],.18,True)
    sounds['sgg']=flourish(2.8,[261.63,311.13,392,523.25,622.25],.13,True)
    sounds['stock']=flourish(1.8,[392,523.25,659.25,1046.5],.11)
    sounds['god']=flourish(4.3,[130.81,196,261.63,329.63,392,523.25,783.99,1046.5],.18,True)
    return sounds

def main():
    OUT.mkdir(parents=True,exist_ok=True)
    for name,mono in create().items():
        mono=mono-np.mean(mono)
        stereo=room(mono,.25 if name.startswith(('lever','stop')) else .42)
        # 先端と終端の切断音を抑え、MP3化前のピークに余裕を残す。
        fade=min(round(.028*SR),len(stereo)//4);stereo[:80]*=np.linspace(0,1,80)[:,None];stereo[-fade:]*=np.linspace(1,0,fade)[:,None]
        stereo*=.72/max(np.max(np.abs(stereo)),.001)
        assert np.isfinite(stereo).all()
        with tempfile.TemporaryDirectory() as td:
            wav=Path(td)/'master.wav';wavfile.write(wav,SR,(stereo*32767).astype(np.int16))
            subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(wav),'-codec:a','libmp3lame','-b:a','128k','-write_xing','1',str(OUT/f'{name}.mp3')],check=True)
        print(f'{name}: {len(stereo)/SR:.2f}s')
if __name__=='__main__':main()
