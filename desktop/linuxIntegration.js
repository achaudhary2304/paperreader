import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';

// Desktop Exec values are not shell commands. Escape both desktop-entry strings
// and the reserved characters inside a double-quoted executable argument.
function quoteExecutable(path) {
  return `"${path
    .replace(/[\\"`$]/g, '\\$&')
    .replaceAll('\\', '\\\\')
    .replaceAll('%', '%%')}"`;
}

export async function registerAppImage({
  appImage,
  iconPath,
  dataHome = isAbsolute(process.env.XDG_DATA_HOME || '')
    ? process.env.XDG_DATA_HOME
    : join(homedir(), '.local', 'share'),
}) {
  if (typeof appImage !== 'string' || !isAbsolute(appImage) || /[\r\n\0]/.test(appImage)) {
    throw new Error('Invalid AppImage path.');
  }
  const applications = join(dataHome, 'applications');
  const icons = join(dataHome, 'icons', 'hicolor', '512x512', 'apps');
  await Promise.all([mkdir(applications, { recursive: true }), mkdir(icons, { recursive: true })]);
  const installedIcon = join(icons, 'paperlens.png');
  await writeFile(installedIcon, await readFile(iconPath));
  const desktopPath = join(applications, 'paperlens.desktop');
  const entry = `[Desktop Entry]
Type=Application
Name=PaperReader
Comment=Read PDFs and webpages with AI chat
Exec=${quoteExecutable(appImage)}
Icon=${installedIcon.replaceAll('\\', '\\\\')}
Terminal=false
Categories=Education;
StartupWMClass=paperlens
X-PaperReader-AppImage=true
`;
  // Refresh the path after an AppImage is moved or updated, without a login service.
  const existing = await readFile(desktopPath, 'utf8').catch(() => '');
  if (existing !== entry) await writeFile(desktopPath, entry, { mode: 0o644 });
  return desktopPath;
}
