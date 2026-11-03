"""独自の回転モーター音。実機の録音は使わない。ループ範囲は0.25〜2.25秒。"""
from pathlib import Path
import json,hashlib,subprocess,tempfile
import numpy as np
from scipy.io import wavfile
SR=44100
out=Path(__file__).resolve().parents[2]/'src/web/public/gaisen-media/reel-motor.mp3'
rng=np.random.default_rng(20261104)
n=SR*2;t=np.arange(n)/SR
f=np.fft.rfftfreq(n,1/SR)
weight=np.exp(-((f-420)/530)**2)*(f>90)*(f<1900)
phases=rng.uniform(0,2*np.pi,len(f));air=np.fft.irfft(weight*np.exp(1j*phases),n=n);air/=max(np.std(air),1e-9)
body=sum(a*np.sin(2*np.pi*freq*t+.035*np.sin(2*np.pi*7*t)) for freq,a in [(88,.42),(176,.19),(264,.08),(352,.035)])
rotor=(body+air*.035)*(1+.07*np.sin(2*np.pi*22*t))
stereo=np.column_stack([rotor,np.roll(rotor,9)*.98+np.roll(air,37)*.004]);stereo=np.tile(stereo,(2,1))[:SR*3]
stereo[:882]*=np.linspace(0,1,882)[:,None];stereo[-882:]*=np.linspace(1,0,882)[:,None];stereo*=.42/np.max(np.abs(stereo))
with tempfile.TemporaryDirectory() as tmp:
 wav=Path(tmp)/'motor.wav';wavfile.write(wav,SR,(stereo*32767).astype(np.int16))
 subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(wav),'-codec:a','libmp3lame','-b:a','128k','-write_xing','1',str(out)],check=True)
 raw=subprocess.check_output(['ffmpeg','-hide_banner','-loglevel','error','-i',str(out),'-f','f32le','-acodec','pcm_f32le','-'])
 samples=np.frombuffer(raw,dtype='<f4');peak=float(np.max(np.abs(samples)));rms=float(20*np.log10(np.sqrt(np.mean(samples*samples))))
manifest=Path(__file__).with_name('manifest.json');m=json.loads(manifest.read_text())
m['files']=[x for x in m['files'] if x['file']!=out.name]
m['files'].append(dict(file=out.name,bytes=out.stat().st_size,sha256=hashlib.sha256(out.read_bytes()).hexdigest(),duration=3,sampleRate=SR,channels=2,decodedPeak=round(peak,5),rmsDbFS=round(rms,2),loopStart=.25,loopEnd=2.25))
manifest.write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n')
print(f'original motor: {out.stat().st_size} bytes; peak={peak:.4f}, RMS={rms:.2f}dBFS; loop=.25..2.25')
