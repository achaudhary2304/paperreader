import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerAppImage } from './linuxIntegration.js';

test(
  'AppImage registration installs its icon and a stable launcher, and refreshes a moved path',
  { skip: process.platform !== 'linux' },
  async () => {
    const dataHome = await mkdtemp(join(tmpdir(), 'paperreader-launcher-'));
    try {
      const iconPath = join(dataHome, 'source.png');
      await writeFile(iconPath, 'test-icon');
      const desktop = await registerAppImage({
        dataHome,
        iconPath,
        appImage: '/home/reader/My apps/PaperReader.AppImage',
      });
      const entry = await readFile(desktop, 'utf8');
      assert.match(entry, /Name=PaperReader\n/);
      assert.match(entry, /Exec="\/home\/reader\/My apps\/PaperReader.AppImage"/);
      assert.ok(
        entry.includes(`Icon=${join(dataHome, 'icons/hicolor/512x512/apps/paperlens.png')}\n`),
      );
      assert.match(entry, /StartupWMClass=paperlens\n/);
      assert.equal(
        await readFile(join(dataHome, 'icons/hicolor/512x512/apps/paperlens.png'), 'utf8'),
        'test-icon',
      );
      const modified = (await stat(desktop)).mtimeMs;
      await registerAppImage({
        dataHome,
        iconPath,
        appImage: '/home/reader/My apps/PaperReader.AppImage',
      });
      assert.equal((await stat(desktop)).mtimeMs, modified);
      await registerAppImage({
        dataHome,
        iconPath,
        appImage: '/home/reader/Apps/PaperReader-new.AppImage',
      });
      assert.match(await readFile(desktop, 'utf8'), /PaperReader-new.AppImage/);
    } finally {
      await rm(dataHome, { recursive: true, force: true });
    }
  },
);

test(
  'AppImage paths cannot inject desktop fields or executable arguments',
  { skip: process.platform !== 'linux' },
  async () => {
    await assert.rejects(
      registerAppImage({ appImage: '/tmp/app\nExec=evil' }),
      /Invalid AppImage path/,
    );
    await assert.rejects(
      registerAppImage({ appImage: 'relative.AppImage' }),
      /Invalid AppImage path/,
    );
    const dataHome = await mkdtemp(join(tmpdir(), 'paperreader-launcher-'));
    try {
      const iconPath = join(dataHome, 'source.png');
      await writeFile(iconPath, 'test-icon');
      const desktop = await registerAppImage({
        dataHome,
        iconPath,
        appImage: '/tmp/50% "quoted" $name `test` \\app.AppImage',
      });
      const entry = await readFile(desktop, 'utf8');
      assert.match(entry, /50%%/);
      assert.match(entry, /\\\\"quoted\\\\"/);
      assert.match(entry, /\\\\\$name/);
      assert.match(entry, /\\\\`test\\\\`/);
      assert.match(entry, /\\\\\\\\app/);
    } finally {
      await rm(dataHome, { recursive: true, force: true });
    }
  },
);
