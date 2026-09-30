export function isEditableTarget(target = document.activeElement) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target.isContentEditable ||
    target.matches('input, textarea, select, [contenteditable="true"]')
  );
}

export function handleEditingKeydown(event) {
  if (!isEditableTarget(event.target)) {
    return false;
  }

  if (event.code === 'Escape') {
    event.preventDefault();
    event.target.blur();
  }

  return true;
}
