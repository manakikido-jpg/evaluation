// 📋 data-copy-text のボタンを押すと、その文をクリップボードに写す
document.addEventListener('click', async (event) => {
  const button = event.target.closest?.('[data-copy-text]');
  if (!button) return;
  const label = button.textContent;
  try {
    await navigator.clipboard.writeText(button.getAttribute('data-copy-text') ?? '');
    button.textContent = '✅ コピーしました';
  } catch {
    button.textContent = 'コピーできませんでした（文をえらんでコピーしてください）';
  }
  setTimeout(() => { button.textContent = label; }, 2000);
});
