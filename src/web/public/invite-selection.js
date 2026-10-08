/* 不明で登録する対象だけを選ぶ。保存は確認欄付きのフォームで行う。 */
(function () {
  'use strict';
  const form = document.getElementById('invite-unknown-bulk');
  if (!form) return;
  const boxes = Array.from(document.querySelectorAll('input[name="memberId"][form="invite-unknown-bulk"]'));
  const count = document.getElementById('invite-unknown-selected');
  const submit = form.querySelector('button[type="submit"]');
  const update = () => {
    const selected = boxes.filter(box => box.checked).length;
    if (count) count.textContent = '選択中 ' + selected + '人';
    if (submit) submit.disabled = selected === 0;
  };
  form.querySelectorAll('[data-invite-select]').forEach(button => button.addEventListener('click', () => {
    boxes.forEach(box => { box.checked = button.dataset.inviteSelect === 'all'; });
    update();
  }));
  boxes.forEach(box => box.addEventListener('change', update));
  update();
})();
