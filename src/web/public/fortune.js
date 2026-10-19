'use strict';
(() => {
 function init() {
  const ticket = document.querySelector('[data-scratch]');
  if (!ticket || ticket.dataset.opened === 'yes' || ticket.dataset.scratchBound) return;
  const canvas = ticket.querySelector('canvas'), ctx = canvas?.getContext('2d');
  if (!ctx) return;
  ticket.dataset.scratchBound = 'yes';
  const form = ticket.querySelector('[data-scratch-form]'), status = ticket.querySelector('[data-scratch-status]');
  ctx.fillStyle = '#b6b7be';ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle = '#30384c';ctx.font = 'bold 30px sans-serif';ctx.textAlign = 'center';ctx.fillText('ここを削ってみよう',300,150);
  let response, loading, drawing = false;
  async function open() {
   if (response) return response;
   if (loading) return loading;
   loading = (async () => {
    const controller = new AbortController();const timer = setTimeout(() => controller.abort(),20000);
    try {
     status.textContent = '結果を確認しています…';
     const res = await fetch(form.action,{method:'POST',body:new FormData(form),headers:{Accept:'application/json'},signal:controller.signal});
     if (!res.headers.get('content-type')?.includes('application/json')) throw Error('ログインを確認して、画面を開き直してください。');
     const data = await res.json();if (!res.ok) throw Error(data.error || '結果を確認できませんでした。');
     response = data;if (!ticket.isConnected) return data;
     ticket.querySelector('[data-scratch-symbols]').textContent = data.symbols.join(' ');
     ticket.querySelector('[data-scratch-result]').textContent = `払戻 ${data.payout.toLocaleString('ja-JP')}（購入額込み）`;
     document.getElementById('fortune-balance').textContent = data.balance.toLocaleString('ja-JP');
     const balance = document.querySelector('.c-balance');if (balance) balance.textContent = `${ticket.dataset.emoji}${data.balance.toLocaleString('ja-JP')} ${ticket.dataset.coin}`;
     status.textContent = '精算しました。続けて削るか、すべて削るボタンで確認できます。';
     return data;
    } catch (e) { status.textContent = (e.name === 'AbortError' ? '通信に時間がかかっています。結果を確認してからやり直してください。' : e.message) + ' 同じ券をもう一度開いても、二重には払いません。';return null; }
    finally { clearTimeout(timer);loading = null; }
   })();
   return loading;
  }
  function erase(e) { if (!drawing || !response) return;const r=canvas.getBoundingClientRect();ctx.globalCompositeOperation='destination-out';ctx.beginPath();ctx.arc((e.clientX-r.left)*canvas.width/r.width,(e.clientY-r.top)*canvas.height/r.height,35,0,Math.PI*2);ctx.fill(); }
  canvas.addEventListener('pointerdown',async e=>{ e.preventDefault();drawing=true;canvas.setPointerCapture(e.pointerId);await open();erase(e); });
  canvas.addEventListener('pointermove',erase);
  canvas.addEventListener('pointerup',()=>{drawing=false;});
  canvas.addEventListener('pointercancel',()=>{drawing=false;});
  form.addEventListener('submit',async e=>{e.preventDefault();const data=await open();if(!data)return;canvas.hidden=true;form.querySelector('button').hidden=true;status.textContent='精算済みです。再読み込みしても同じ結果を確認できます。';});
 }
 init();
 document.addEventListener('c-page-swapped',init);
})();
