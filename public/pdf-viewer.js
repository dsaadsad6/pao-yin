import * as pdfjsLib from '/vendor/pdfjs/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';

// 把一份 PDF 的每一頁畫成縮圖,放進 container 裡。
// 使用者可以點縮圖切換選取狀態、拖曳調整順序。
// 回傳一個物件,讓外面可以讀目前的選取/順序狀態,以及重設。
export async function renderPageGrid(pdfBytes, container, { onChange } = {}) {
  container.innerHTML = '';
  const doc = await pdfjsLib.getDocument({ data: pdfBytes }).promise;
  const numPages = doc.numPages;

  // order: 目前縮圖排列順序(原始頁碼,1-indexed)
  // selected: 目前被選取(要列印)的原始頁碼集合
  let order = Array.from({ length: numPages }, (_, i) => i + 1);
  const selected = new Set(order);
  let reordered = false;
  let dragFromIndex = null;
  const rotations = new Map(); // pageNum -> 0/90/180/270

  function isCustomOrder() {
    if (!reordered) return false;
    const selectedInOrder = order.filter((p) => selected.has(p));
    return selectedInOrder.some((p, i) => i > 0 && p < selectedInOrder[i - 1]);
  }

  function emitChange() {
    if (onChange) {
      onChange({
        numPages,
        selected: order.filter((p) => selected.has(p)),
        isCustomOrder: isCustomOrder(),
      });
    }
  }

  const cards = new Map(); // pageNum -> element

  function renderOrder() {
    order.forEach((pageNum, idx) => {
      const card = cards.get(pageNum);
      card.style.order = idx;
      const badge = card.querySelector('.pg-badge');
      badge.textContent = idx + 1;
      card.classList.toggle('pg-selected', selected.has(pageNum));
    });
  }

  for (let i = 1; i <= numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    const scale = 140 / viewport.width;
    const scaledViewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = scaledViewport.width;
    canvas.height = scaledViewport.height;
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport: scaledViewport }).promise;

    const card = document.createElement('div');
    card.className = 'pg-card pg-selected';
    card.draggable = true;
    card.dataset.page = String(i);
    card.style.order = i - 1;

    const badge = document.createElement('div');
    badge.className = 'pg-badge';
    badge.textContent = String(i);

    const check = document.createElement('div');
    check.className = 'pg-check';
    check.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';

    const rotateBtn = document.createElement('button');
    rotateBtn.type = 'button';
    rotateBtn.className = 'pg-rotate';
    rotateBtn.title = '旋轉此頁';
    rotateBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>';
    rotateBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const pageNum = Number(card.dataset.page);
      const next = ((rotations.get(pageNum) || 0) + 90) % 360;
      if (next === 0) rotations.delete(pageNum);
      else rotations.set(pageNum, next);
      canvas.style.transform = next ? `rotate(${next}deg)` : '';
      emitChange();
    });

    card.appendChild(canvas);
    card.appendChild(badge);
    card.appendChild(check);
    card.appendChild(rotateBtn);
    container.appendChild(card);
    cards.set(i, card);

    card.addEventListener('click', () => {
      const pageNum = Number(card.dataset.page);
      if (selected.has(pageNum)) {
        if (selected.size === 1) return; // 至少留一頁
        selected.delete(pageNum);
      } else {
        selected.add(pageNum);
      }
      renderOrder();
      emitChange();
    });

    card.addEventListener('dragstart', (e) => {
      dragFromIndex = order.indexOf(Number(card.dataset.page));
      e.dataTransfer.effectAllowed = 'move';
    });
    card.addEventListener('dragover', (e) => e.preventDefault());
    card.addEventListener('drop', (e) => {
      e.preventDefault();
      const toPage = Number(card.dataset.page);
      const toIndex = order.indexOf(toPage);
      if (dragFromIndex === null || toIndex === dragFromIndex) return;
      const [moved] = order.splice(dragFromIndex, 1);
      order.splice(toIndex, 0, moved);
      reordered = true;
      renderOrder();
      emitChange();
      dragFromIndex = null;
    });
  }

  emitChange();

  return {
    reset() {
      order = Array.from({ length: numPages }, (_, i) => i + 1);
      selected.clear();
      order.forEach((p) => selected.add(p));
      reordered = false;
      rotations.forEach((_, pageNum) => {
        const card = cards.get(pageNum);
        if (card) card.querySelector('canvas').style.transform = '';
      });
      rotations.clear();
      renderOrder();
      emitChange();
    },
    selectAll() {
      order.forEach((p) => selected.add(p));
      renderOrder();
      emitChange();
    },
    getRotations() {
      return Object.fromEntries(rotations);
    },
  };
}
