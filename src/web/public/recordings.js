(() => {
  'use strict';
  const root = document.getElementById('recorder');
  if (!root) return;
  const start = document.getElementById('recording-start');
  const stop = document.getElementById('recording-stop');
  const status = document.getElementById('recording-status');
  const preview = document.getElementById('recording-preview');
  const local = document.getElementById('recording-local');
  let recorder, streams = [], chunks = [], queued = Promise.resolve(), failed = false, total = 0, seq = 0, id, timer, audio, localUrl;
  const say = text => { status.textContent = text; };
  async function post(url, body, headers = {}) {
    const response = await fetch(url, { method: 'POST', body, headers: { 'x-csrf-token': root.dataset.csrf, ...headers }, redirect: 'error' });
    if (!response.ok) throw new Error(response.status === 403 ? '権限またはログイン期限を確認してください。' : await response.text());
    return response.json();
  }
  function release() {
    clearTimeout(timer);
    streams.forEach(s => s.getTracks().forEach(t => t.stop()));
    streams = [];
    if (audio) void audio.close();
    audio = undefined;
    preview.srcObject = null;
  }
  function finishLocal(mime) {
    if (localUrl) URL.revokeObjectURL(localUrl);
    localUrl = URL.createObjectURL(new Blob(chunks, { type: mime }));
    local.href = localUrl;
    local.download = `sakuranomiya-recording.${mime.startsWith('video/mp4') ? 'mp4' : 'webm'}`;
    local.hidden = false;
  }
  start.addEventListener('click', async () => {
    if (!document.getElementById('recording-consent').checked) return say('映る人・声が入る人に確認して、チェックを入れてください。');
    if (!window.isSecureContext || !navigator.mediaDevices || !window.MediaRecorder) return say('HTTPSで、録画に対応したブラウザから開いてください。');
    start.disabled = true;
    failed = false; total = 0; seq = 0; chunks = []; queued = Promise.resolve(); local.hidden = true;
    const mode = document.getElementById('recording-mode').value;
    try {
      const mime = ['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find(t => MediaRecorder.isTypeSupported(t));
      if (!mime) throw new Error('このブラウザでは録画できません。');
      const source = mode === 'camera'
        ? await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        : await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: true });
      streams.push(source);
      let captured = source;
      if (mode === 'screen' && document.getElementById('recording-mic').checked) {
        const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
        streams.push(mic);
        audio = new AudioContext();
        await audio.resume();
        const dest = audio.createMediaStreamDestination();
        if (source.getAudioTracks().length) audio.createMediaStreamSource(source).connect(dest);
        audio.createMediaStreamSource(mic).connect(dest);
        captured = new MediaStream([...source.getVideoTracks(), ...dest.stream.getAudioTracks()]);
        streams.push(captured);
      }
      preview.srcObject = captured;
      await preview.play();
      const data = new FormData();
      data.set('title', document.getElementById('recording-title').value);
      data.set('kind', mode); data.set('mime', mime.split(';')[0]); data.set('consent', 'yes');
      ({ id } = await post('/recordings/create', data));
      recorder = new MediaRecorder(captured, { mimeType: mime, videoBitsPerSecond: 800000, audioBitsPerSecond: 64000 });
      recorder.addEventListener('dataavailable', e => {
        if (!e.data.size) return;
        chunks.push(e.data); total += e.data.size;
        if (total > Number(root.dataset.maxBytes)) { failed = true; say('容量の上限です。録画を止めました。手元へ保存してください。'); if (recorder.state !== 'inactive') recorder.stop(); return; }
        queued = queued.then(async () => {
          if (failed) return;
          for (let at = 0; at < e.data.size; at += 1024 * 1024) {
            const part = e.data.slice(at, at + 1024 * 1024);
            // 同じ番号・内容の再送は、サーバーで二重に保存しない。
            let last;
            for (let attempt = 0; attempt < 3; attempt++) {
              try { await post(`/recordings/${id}/chunk`, part, { 'content-type': 'application/octet-stream', 'x-chunk-seq': String(seq) }); last = undefined; break; }
              catch (err) { last = err; }
            }
            if (last) throw last;
            seq++;
          }
        }).catch(err => { failed = true; say(`保存に失敗しました。${err.message} 録画を止め、手元へ保存してください。`); if (recorder.state !== 'inactive') recorder.stop(); });
      });
      recorder.addEventListener('stop', async () => {
        stop.disabled = true; release(); say(failed ? '手元へ保存する準備中…' : '最後の部分を保存中…');
        await queued;
        finishLocal(mime);
        if (!failed && chunks.length) {
          try { await post(`/recordings/${id}/finish`, new FormData()); say('保存しました。ページを開き直すと一覧から再生できます。手元にも保存できます。'); }
          catch (err) { say(`保存に失敗しました。${err.message} 下のリンクから手元に保存してください。`); }
        } else say('社務所への保存は完了していません。下のリンクから手元に保存してください。');
        start.disabled = false;
      }, { once: true });
      recorder.addEventListener('error', () => { failed = true; if (recorder.state !== 'inactive') recorder.stop(); });
      source.getVideoTracks().forEach(t => t.addEventListener('ended', () => { if (recorder.state !== 'inactive') recorder.stop(); }));
      if (source.getVideoTracks().some(t => t.readyState !== 'live')) throw new Error('共有が終了しています。選び直してください。');
      recorder.start(2000); stop.disabled = false;
      say(`● 録画中。${captured.getAudioTracks().length ? '音声あり（録音内容は保存後に確認してください）' : '音声なし'}。「止めて保存する」で終了します。`);
      timer = setTimeout(() => { if (recorder.state !== 'inactive') recorder.stop(); }, Number(root.dataset.maxMinutes) * 60000);
    } catch (err) { release(); say(`始められませんでした。${err.message}`); start.disabled = false; }
  });
  stop.addEventListener('click', () => { if (recorder && recorder.state !== 'inactive') recorder.stop(); });
  window.addEventListener('beforeunload', e => { if ((recorder && recorder.state !== 'inactive') || stop.disabled && start.disabled) { e.preventDefault(); e.returnValue = ''; } });
})();
