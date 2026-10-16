import { Menu } from 'electron';

export function installEditCommands(contents) {
  // Route paste to the actual view receiving the keyboard event, including embedded pages.
  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !(input.control || input.meta) || input.alt || input.key.toLowerCase() !== 'v') return;
    event.preventDefault();
    if (input.shift) contents.pasteAndMatchStyle(); else contents.paste();
  });
  contents.on('context-menu', (_event, params) => {
    const actions = [];
    if (params.selectionText) actions.push({ label: 'Copy', click: () => contents.copy() });
    if (params.isEditable) actions.push({ label: 'Cut', click: () => contents.cut() }, { label: 'Paste', click: () => { contents.focus(); contents.paste(); } }, { label: 'Select all', click: () => contents.selectAll() });
    if (actions.length) Menu.buildFromTemplate(actions).popup();
  });
}
