// 映像と接続情報はこのページ内だけ。外部への解析送信・保存はしない。
(()=>{
 const root=document.getElementById('event-stream');if(!root)return;
 const $=id=>document.getElementById(id),video=$('event-video');let state=null,hls=null,timer=0,keyTimer=0,request=null,busy=false,playing=false,receiving=false,playId=null,ticket=0,keyTicket=0;
 const message=text=>{$('event-connection').textContent=text;};
 const error=text=>{$('event-error').hidden=!text;$('event-error').textContent=text||'';};
 function hideKey(){keyTicket++;clearTimeout(keyTimer);for(const id of ['event-server','event-key'])if($(id)){$(id).value='';if(id==='event-key')$(id).type='password';}if($('event-publisher'))$('event-publisher').hidden=true;}
 function stop(){ticket++;hls?.destroy();hls=null;video.pause();video.removeAttribute('src');video.load();playing=false;receiving=false;playId=null;$('event-placeholder').hidden=false;}
 function render(value){const before=state?.event;state=value;const e=value.event,live=value.configured&&e?.status==='live';
  if(playing&&(!live||playId!==e?.id))stop();if(before?.id!==e?.id||e?.status==='closed')hideKey();
  $('event-title').textContent=e?.title||'イベント配信';$('event-notice').textContent=e?.notice||'';
  $('event-play').disabled=!live||busy;$('event-play').textContent=playing?'視聴を止める':'視聴を始める';$('event-reconnect').disabled=!live||busy;
  $('event-wait').textContent=e?.status==='closed'?'また、次のイベントで。':live?'配信の会場が開きました':'まもなく、ここで。';
  message(!value.configured?'配信の準備中です。':e?.status==='closed'?'イベントは終了しました。':live?(playing?(receiving?'ライブ映像を視聴しています。':'映像を受信しています…'):'「視聴を始める」を押して参加してください。'):'運営が配信を始めるまでお待ちください。');
  for(const form of root.querySelectorAll('[data-event-action]')){const a=form.dataset.eventAction;form.querySelector('button').disabled=busy||!value.configured||!value.staff||(a==='create'&&e&&e.status!=='closed')||(a==='start'&&e?.status!=='ready')||(a==='stop'&&(!e||e.status==='closed'));}
  if($('event-key-show'))$('event-key-show').disabled=busy||!value.staff||!value.configured||!e||e.status==='closed';
 }
 async function json(path,options={}){const response=await fetch(path,{credentials:'same-origin',cache:'no-store',redirect:'error',...options});const data=await response.json();if(!response.ok)throw Error(data.error||'接続を確認できません。');return data;}
 function schedule(){clearTimeout(timer);if(!document.hidden)timer=setTimeout(poll,5000);}
 async function poll(){if(document.hidden)return;request?.abort();request=new AbortController();try{render(await json('/visit/event/state',{signal:request.signal}));error('');}catch(e){if(e.name!=='AbortError'){stop();hideKey();message('接続を確認しています…');error(e.message);}}finally{schedule();}}
 async function play(){if(!state?.configured||state.event?.status!=='live')return;stop();const generation=ticket,e=state.event;playId=e.id;playing=true;$('event-placeholder').hidden=true;error('');
  const src='/visit/event/media/'+e.id+'/index.m3u8';
  try{
   if(video.canPlayType('application/vnd.apple.mpegurl')&&(/Apple/.test(navigator.vendor)||!window.Hls?.isSupported())){video.src=src;await video.play();}
   else if(window.Hls?.isSupported()){
    hls=new window.Hls({enableWorker:false,lowLatencyMode:true,backBufferLength:10,maxBufferLength:12,maxMaxBufferLength:20,liveSyncDurationCount:2,liveMaxLatencyDurationCount:5,manifestLoadingMaxRetry:2,levelLoadingMaxRetry:2,fragLoadingMaxRetry:2});
    hls.on(window.Hls.Events.ERROR,(_event,data)=>{if(data.fatal&&generation===ticket){stop();message('映像を受信できません。「ライブに戻る」で接続し直してください。');}});
    hls.on(window.Hls.Events.MANIFEST_PARSED,()=>{if(generation===ticket)void video.play().catch(()=>{message('再生ボタンを押してください。');});});hls.loadSource(src);hls.attachMedia(video);
   }else throw Error('このブラウザーはライブ映像に対応していません。Safariまたは新しいChromeなどで開いてください。');
   if(generation===ticket)render(state);
  }catch(e){if(generation===ticket){stop();error(e.message||'再生ボタンを押してください。');}}
 }
 $('event-play').addEventListener('click',()=>{if(!playing)void play();else{stop();if(state)render(state);}});$('event-reconnect').addEventListener('click',()=>void play());
 video.addEventListener('playing',()=>{receiving=true;if(state)render(state);});
 video.addEventListener('waiting',()=>{receiving=false;if(playing)message('映像を受信しています…');});
 video.addEventListener('pause',()=>{receiving=false;if(playing)message('一時停止中です。再生ボタンで戻れます。');});
 video.addEventListener('error',()=>{if(playing){stop();message('映像の受信が止まりました。「ライブに戻る」を押してください。');}});
 $('event-fullscreen').addEventListener('click',async()=>{try{if(video.webkitEnterFullscreen)video.webkitEnterFullscreen();else await root.querySelector('.screen').requestFullscreen();}catch{error('端末の全画面ボタンをお使いください。');}});
 for(const form of root.querySelectorAll('[data-event-action]'))form.addEventListener('submit',async event=>{
  event.preventDefault();if(busy)return;busy=true;render(state);error('');hideKey();const body=new URLSearchParams(new FormData(form));body.set('action',form.dataset.eventAction);if(state.event){body.set('id',state.event.id);body.set('version',String(state.event.version));}
  try{const result=await json('/visit/event/control',{method:'POST',body});render(result);if(result.warning)error(result.warning);}
  catch(e){error(e.message);}finally{busy=false;if(state)render(state);}
 });
 $('event-key-show')?.addEventListener('click',async()=>{if(busy)return;hideKey();const generation=keyTicket;try{const body=new URLSearchParams({_csrf:$('event-key-show').dataset.csrf});const data=await json('/visit/event/publisher',{method:'POST',body});if(document.hidden||generation!==keyTicket)return;$('event-server').value=data.server;$('event-key').value=data.key;$('event-key-expiry').textContent='有効期限：'+new Date(data.expiresAt).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})+'（日本時間）';$('event-publisher').hidden=false;keyTimer=setTimeout(hideKey,60000);}catch(e){error(e.message);}});
 $('event-key-copy')?.addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('event-key').value);message('配信鍵をコピーしました。OBSのストリームキー欄へ貼り付けてください。');}catch{$('event-key').type='text';$('event-key').select();message('配信鍵を選択しました。コピーしてOBSへ貼り付けてください。');}});
 $('event-key-hide')?.addEventListener('click',hideKey);document.addEventListener('visibilitychange',()=>{if(document.hidden){clearTimeout(timer);request?.abort();stop();hideKey();}else void poll();});window.addEventListener('pagehide',()=>{clearTimeout(timer);request?.abort();stop();hideKey();});window.addEventListener('blur',hideKey);
 void poll();
})();
