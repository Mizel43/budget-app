export function openEditor(elements, { title, fields }) {
  return new Promise(resolve => {
    elements.editorTitle.textContent = title;
    elements.editorFields.replaceChildren();
    fields.forEach(field => {
      const label = document.createElement('label');
      label.htmlFor = `editor-${field.name}`;
      label.textContent = field.label;
      const input = document.createElement(field.type === 'select' ? 'select' : 'input');
      Object.assign(input, { id: `editor-${field.name}`, name: field.name, value: field.value ?? '', required: field.required ?? true });
      if (input instanceof HTMLInputElement) input.type = field.type ?? 'text';
      field.options?.forEach(option => {
        const node = document.createElement('option');
        node.value = option.value;
        node.textContent = option.label;
        node.disabled = Boolean(option.disabled);
        input.append(node);
      });
      if (field.options) input.value = field.value ?? '';
      if (field.inputMode) input.inputMode = field.inputMode;
      if (field.min != null) input.min = String(field.min);
      if (field.max != null) input.max = String(field.max);
      if (field.step != null) input.step = String(field.step);
      elements.editorFields.append(label, input);
    });
    const close = value => {
      elements.editorForm.onsubmit = null;
      elements.cancelEditorButton.onclick = null;
      elements.editorDialog.close();
      resolve(value);
    };
    elements.editorForm.onsubmit = event => {
      event.preventDefault();
      if (!elements.editorForm.reportValidity()) return;
      close(Object.fromEntries(new FormData(elements.editorForm)));
    };
    elements.cancelEditorButton.onclick = () => close(null);
    elements.editorDialog.showModal();
    elements.editorFields.querySelector('input, select')?.focus();
  });
}
