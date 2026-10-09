(() => {
  const editor = document.querySelector('[data-voice-editor]');
  if (!editor) return;
  const inputs = [...editor.querySelectorAll('input[name="voiceChannelIds"]')];
  const search = editor.querySelector('[data-voice-search]');
  const options = [...editor.querySelectorAll('[data-voice-option]')];
  const count = editor.querySelector('[data-voice-count]');
  const update = () => {
    const selected = inputs.filter(input => input.checked).length;
    count.textContent = `${selected} / 20部屋を選択`;
    inputs.forEach(input => { input.disabled = !input.checked && selected >= 20; });
  };
  const filter = () => {
    const query = search.value.trim().toLocaleLowerCase('ja-JP');
    options.forEach(option => { option.hidden = !option.dataset.search.toLocaleLowerCase('ja-JP').includes(query); });
    editor.querySelectorAll('.guide-voice-group').forEach(group => {
      group.hidden = ![...group.querySelectorAll('[data-voice-option]')].some(option => !option.hidden);
    });
    editor.querySelector('[data-voice-empty]').hidden = options.some(option => !option.hidden);
  };
  search.addEventListener('input', filter);
  inputs.forEach(input => input.addEventListener('change', update));
  editor.querySelector('[data-voice-reset]').addEventListener('click', () => {
    inputs.forEach(input => { input.checked = input.defaultChecked; });
    search.value = '';
    filter();
    update();
    editor.open = false;
    editor.querySelector('summary').focus();
  });
  update();
})();
