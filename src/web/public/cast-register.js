(() => {
 function init() {
  const form = document.getElementById('cast-register');
  if (!form || form.dataset.castRegisterReady) return;
  form.dataset.castRegisterReady = "yes";
  const search = form.querySelector('[data-cast-search]');
  const select = form.querySelector('[data-cast-member]');
  const options = Array.from(select.options).slice(1).map(o => o.cloneNode(true));
  let selected = select.value;
  const status = form.querySelector('[data-cast-search-status]');
  search.closest('label').hidden = false;
  const normalize = text => text.normalize('NFKC').toLocaleLowerCase('ja-JP').trim();
  search.addEventListener('input', () => {
    const query = normalize(search.value);
    const matches = options.filter(o => normalize(o.textContent).includes(query));
    // 選んだ本人は検索で消さず、別の人へ勝手に切り替えない。
    const keep = options.find(o => o.value === selected);
    select.replaceChildren(new Option('人を選んでください', ''), ...matches.map(o => o.cloneNode(true)));
    if (keep && !matches.some(o => o.value === selected)) select.add(keep.cloneNode(true));
    select.value = selected;
    status.textContent = matches.length ? `${matches.length}人が候補です。名前とIDを確認して選んでください。` : '該当する人がいません。別の名前やIDで探してください。';
  });
  select.addEventListener('change', () => { selected = select.value; });
  const template = form.querySelector('[data-cast-template]');
  const custom = form.querySelector('[data-cast-custom]');
  const mode = () => {
    const use = form.querySelector('[name=useTemplate]:checked')?.value === 'yes';
    template.hidden = template.disabled = !use;
    custom.hidden = custom.disabled = use;
    custom.querySelector('[name=menuName]').required = !use;
  };
  form.querySelectorAll('[name=useTemplate]').forEach(r => r.addEventListener('change', mode));
  mode();
  form.addEventListener('submit', event => {
    if (form.querySelector('[name=useTemplate]:checked')?.value === 'yes' && !form.querySelector('[name=tpl]:checked')) {
      event.preventDefault();
      form.querySelector('[data-cast-submit-status]').textContent = '入れるテンプレの品を1つ以上選んでください。';
      template.querySelector('input[type=checkbox]')?.focus();
      return;
    }
    if (form.dataset.submitting) { event.preventDefault(); return; }
    form.dataset.submitting = 'true';
    form.querySelector('button[type=submit]').disabled = true;
    form.querySelector('[data-cast-submit-status]').textContent = '登録しています…';
  });
 }
 const reset = () => {
    init();
    const form = document.getElementById('cast-register');
    if (!form) return;
    delete form.dataset.submitting;
    form.querySelector('button[type=submit]').disabled = false;
    form.querySelector('[data-cast-submit-status]').textContent = '';
    requestAnimationFrame(() => document.getElementById('cast-registration-error')?.focus());
 };
 init();
 window.addEventListener('pageshow', reset);
 document.addEventListener('office:updated', init);
 document.addEventListener('htmx:afterSwap', init);
})();
