import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProviderSettings } from './providerSettings.js';

const keyring = {
  getSelectedStorageBackend: () => 'gnome_libsecret',
  isAsyncEncryptionAvailable: async () => true,
  encryptStringAsync: async (text) => Buffer.from(text).map((byte) => byte ^ 0x5a),
  decryptStringAsync: async (buffer) => ({
    result: Buffer.from(buffer)
      .map((byte) => byte ^ 0x5a)
      .toString(),
    shouldReEncrypt: false,
  }),
};

test('desktop keys persist locally without exposing plaintext or returning secrets', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'paperlens-settings-'));
  try {
    const settings = createProviderSettings(dir, keyring);
    await settings.load();
    const result = await settings.save({
      GROQ_API_KEY: 'example-groq-secret',
      OPENROUTER_API_KEY: 'example-router-secret',
      LLM_MODEL: 'model-a',
    });
    assert.equal(result.GROQ_API_KEY, true);
    assert.equal(result.OPENROUTER_API_KEY, true);
    assert.equal(result.LLM_MODEL, 'model-a');
    assert.ok(
      !readFileSync(join(dir, 'provider-settings.txt'), 'utf8').includes('example-groq-secret'),
    );
    assert.ok(
      !readFileSync(join(dir, 'provider-secrets.bin'), 'utf8').includes('example-groq-secret'),
    );
    const reloaded = createProviderSettings(dir, keyring);
    assert.equal((await reloaded.load()).GROQ_API_KEY, true);
    assert.equal(process.env.GROQ_API_KEY, 'example-groq-secret');
    assert.equal((await reloaded.save({ clear: ['GROQ_API_KEY'] })).GROQ_API_KEY, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.GROQ_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.LLM_MODEL;
  }
});

test('existing plaintext provider keys migrate into protected storage', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'paperlens-migrate-'));
  try {
    writeFileSync(
      join(dir, 'provider-settings.txt'),
      'GROQ_API_KEY=legacy-secret\nLLM_MODEL=old-model\n',
      { mode: 0o600 },
    );
    const settings = createProviderSettings(dir, keyring);
    assert.equal((await settings.load()).GROQ_API_KEY, true);
    assert.ok(!readFileSync(join(dir, 'provider-settings.txt'), 'utf8').includes('legacy-secret'));
    assert.equal(process.env.GROQ_API_KEY, 'legacy-secret');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.GROQ_API_KEY;
    delete process.env.LLM_MODEL;
  }
});

test('new secrets are not persisted without a secure Linux keyring', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'paperlens-no-keyring-'));
  try {
    const settings = createProviderSettings(
      dir,
      {
        ...keyring,
        getSelectedStorageBackend: () => 'basic_text',
      },
      { platform: 'linux' },
    );
    await settings.load();
    await assert.rejects(settings.save({ GROQ_API_KEY: 'do-not-write' }), /system keyring/);
    assert.equal(settings.status().GROQ_API_KEY, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const platform of ['win32', 'darwin']) {
  test(`${platform} saves and reloads protected keys without the Linux-only backend API`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'paperreader-native-storage-'));
    const { getSelectedStorageBackend, ...nativeStorage } = keyring;
    assert.equal(nativeStorage.getSelectedStorageBackend, undefined);
    try {
      const settings = createProviderSettings(dir, nativeStorage, { platform });
      assert.equal((await settings.load()).secureStorage, true);
      await settings.save({ GROQ_API_KEY: 'native-test-secret' });
      const encrypted = readFileSync(join(dir, 'provider-secrets.bin'));
      assert.ok(!encrypted.includes(Buffer.from('native-test-secret')));
      const reloaded = createProviderSettings(dir, nativeStorage, { platform });
      assert.equal((await reloaded.load()).GROQ_API_KEY, true);
      assert.equal(process.env.GROQ_API_KEY, 'native-test-secret');
      assert.deepEqual(readFileSync(join(dir, 'provider-secrets.bin')), encrypted);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      delete process.env.GROQ_API_KEY;
    }
  });
}

test('Windows unavailable protected storage preserves the existing encrypted file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'paperreader-windows-storage-'));
  const { getSelectedStorageBackend, ...nativeStorage } = keyring;
  try {
    const working = createProviderSettings(dir, nativeStorage, { platform: 'win32' });
    await working.load();
    await working.save({ GROQ_API_KEY: 'previous-test-secret' });
    const encrypted = readFileSync(join(dir, 'provider-secrets.bin'));
    const unavailable = createProviderSettings(
      dir,
      {
        ...nativeStorage,
        isAsyncEncryptionAvailable: async () => false,
      },
      { platform: 'win32' },
    );
    await assert.rejects(
      unavailable.save({ GROQ_API_KEY: 'replacement-test-secret' }),
      /Protected system storage is unavailable/,
    );
    assert.deepEqual(readFileSync(join(dir, 'provider-secrets.bin')), encrypted);
    assert.equal(unavailable.status().GROQ_API_KEY, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.GROQ_API_KEY;
  }
});

test('Linux fails closed if its selected storage backend cannot be checked', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'paperreader-linux-storage-'));
  const { getSelectedStorageBackend, ...unknownStorage } = keyring;
  try {
    const settings = createProviderSettings(dir, unknownStorage, { platform: 'linux' });
    assert.equal((await settings.load()).secureStorage, false);
    await assert.rejects(settings.save({ GROQ_API_KEY: 'test-secret' }), /system keyring/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
