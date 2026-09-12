// 把原生 <select> 包成自訂樣式的下拉選單,視覺完全可控,
// 但底層還是操作原本的 <select>,所以既有的 value/options/change 邏輯不用改。
export function createCustomSelect(selectEl) {
  const wrap = document.createElement('div');
  wrap.className = 'cs-wrap' + (selectEl.className ? ' ' + selectEl.className : '');

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'cs-trigger';
  trigger.innerHTML =
    '<span class="cs-label"></span>' +
    '<svg class="cs-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';

  const panel = document.createElement('div');
  panel.className = 'cs-panel';
  panel.hidden = true;

  selectEl.parentNode.insertBefore(wrap, selectEl);
  wrap.appendChild(trigger);
  wrap.appendChild(panel);
  wrap.appendChild(selectEl);
  selectEl.classList.add('cs-native');

  function render() {
    const label = trigger.querySelector('.cs-label');
    const selectedOption = selectEl.options[selectEl.selectedIndex];
    label.textContent = selectedOption ? selectedOption.textContent : '';
    trigger.disabled = selectEl.disabled;
    trigger.classList.toggle('disabled', selectEl.disabled);

    panel.innerHTML = '';
    [...selectEl.options].forEach((opt) => {
      if (opt.hidden) return;
      const item = document.createElement('div');
      item.className = 'cs-option' + (opt.selected ? ' active' : '');
      item.textContent = opt.textContent;
      item.addEventListener('click', () => {
        selectEl.value = opt.value;
        selectEl.dispatchEvent(new Event('change', { bubbles: true }));
        close();
      });
      panel.appendChild(item);
    });
  }

  function onDocClick(e) {
    if (!wrap.contains(e.target)) close();
  }

  function open() {
    if (selectEl.disabled) return;
    render();
    panel.hidden = false;
    trigger.classList.add('open');
    document.addEventListener('click', onDocClick, true);
  }

  function close() {
    panel.hidden = true;
    trigger.classList.remove('open');
    document.removeEventListener('click', onDocClick, true);
  }

  trigger.addEventListener('click', () => {
    if (panel.hidden) open(); else close();
  });

  selectEl.addEventListener('change', render);
  render();

  return { refresh: render };
}
