'use strict';

const pet = document.querySelector('.pet');
let dragStart = null;

function applyTheme(theme) {
  const scheme = typeof theme?.scheme === 'string' ? theme.scheme : '';
  document.documentElement.dataset.theme = scheme === 'dark' ? 'dark' : 'light';
}

function clearHappy() {
  pet.classList.remove('is-happy');
}

function showHappy() {
  pet.classList.add('is-happy');
  window.setTimeout(clearHappy, 420);
}

pet.addEventListener('click', () => {
  if (!dragStart || (Math.abs(dragStart.lastX - dragStart.startX) < 4 && Math.abs(dragStart.lastY - dragStart.startY) < 4)) {
    showHappy();
  }
});

pet.addEventListener('pointerdown', (event) => {
  dragStart = {
    startX: event.clientX,
    startY: event.clientY,
    lastX: event.clientX,
    lastY: event.clientY,
  };
  pet.classList.add('is-dragging');
  pet.setPointerCapture?.(event.pointerId);
});

pet.addEventListener('pointermove', (event) => {
  if (!dragStart) return;
  dragStart.lastX = event.clientX;
  dragStart.lastY = event.clientY;
  const dx = event.clientX - dragStart.startX;
  const dy = event.clientY - dragStart.startY;
  pet.style.transform = `translate(${dx}px, ${dy}px)`;
});

async function finishDrag(event) {
  if (!dragStart) return;
  const dx = event.clientX - dragStart.startX;
  const dy = event.clientY - dragStart.startY;
  const moved = Math.abs(dx) >= 4 || Math.abs(dy) >= 4;
  pet.classList.remove('is-dragging');
  pet.style.transform = '';
  dragStart = null;
  if (moved) {
    await window.shell.commitDrag({ deltaX: dx, deltaY: dy });
  }
}

pet.addEventListener('pointerup', finishDrag);
pet.addEventListener('pointercancel', finishDrag);

window.shell.onTheme(applyTheme);
window.shell.getState().then(({ theme }) => applyTheme(theme)).catch(() => {});
