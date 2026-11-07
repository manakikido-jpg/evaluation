// 社務所の画面内更新でも、新しい抽選結果と確認ボタンを初期化する。
(()=>{
 const forms=new WeakSet(),stages=new WeakSet(),histories=new WeakSet();
 function init(){
  for(const form of document.querySelectorAll('form')){
   if(forms.has(form)||!form.querySelector('[name="action"]'))continue;forms.add(form);
   form.addEventListener('submit',e=>{const action=form.querySelector('[name="action"]').value;
    if(action==='cancel'&&!confirm('イベントを中止し、参加費を全員へ返金しますか？')){e.preventDefault();return;}
    if(action==='open'&&!confirm('受付を開始します。以後、参加費と景品を変更できません。よろしいですか？')){e.preventDefault();return;}
   });
  }
  // 保存済み履歴も、演出と同じ発表時刻まで表示しない。再読込時も同じ時刻を使う。
  for(const row of document.querySelectorAll('[data-el-history-at]')){
   if(histories.has(row))continue;histories.add(row);const left=Math.max(0,Math.min(3000,Number(row.dataset.elHistoryAt)-Date.now()));
   row.hidden=left>0;if(left)setTimeout(()=>{row.hidden=false;},left);
  }
  const s=document.querySelector('[data-el-result]');if(!s||stages.has(s))return;stages.add(s);
  const winner=s.querySelector('[data-el-winner]'),spin=s.querySelector('[data-el-spinner]');
  const left=Math.max(0,Math.min(3000,Number(s.dataset.elAt)-Date.now()));
  if(!left||matchMedia('(prefers-reduced-motion: reduce)').matches){spin.hidden=true;return;}
  winner.hidden=true;const names=JSON.parse(s.dataset.elNames||'[]');let n=0;
  const timer=setInterval(()=>{if(!s.isConnected){clearInterval(timer);return;}spin.textContent=names[n++%names.length]||'抽選中';},80);
  setTimeout(()=>{clearInterval(timer);spin.hidden=true;winner.hidden=false;winner.setAttribute('role','status');},left);
 }
 init();document.addEventListener('office:updated',init);
})();
