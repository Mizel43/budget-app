export function actionButton(label, className, action) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `button secondary small ${className}`;
  button.textContent = label;
  button.addEventListener('click', action);
  return button;
}

export function iconButton(label, iconPath, action, danger = false) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `icon-button${danger ? ' danger' : ''}`;
  button.setAttribute('aria-label', label);
  button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${iconPath}"/></svg>`;
  button.addEventListener('click', action);
  return button;
}

export function pawPrintMarkup() {
  return '<svg viewBox="0 0 40 40" focusable="false"><ellipse cx="8" cy="14" rx="4" ry="5" transform="rotate(-28 8 14)"/><ellipse cx="16" cy="9" rx="4" ry="5" transform="rotate(-10 16 9)"/><ellipse cx="25" cy="9" rx="4" ry="5" transform="rotate(10 25 9)"/><ellipse cx="33" cy="14" rx="4" ry="5" transform="rotate(28 33 14)"/><path d="M9.5 28c0-5 3.5-10.5 10.5-10.5S30.5 23 30.5 28c0 4-3.4 6.5-6.5 6.5-1.6 0-2.8-.8-4-.8-1.2 0-2.4.8-4 .8-3.1 0-6.5-2.5-6.5-6.5Z"/></svg>';
}
