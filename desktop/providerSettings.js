import { chmodSync, existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'dotenv';

const KEYS = ['OPENROUTER_API_KEY', 'GROQ_API_KEY', 'LLM_API_KEY'];
const OPTIONS = ['LLM_BASE_URL', 'LLM_MODEL', 'LLM_VISION_MODEL', 'LLM_PROVIDER_NAME'];
const FIELDS = [...KEYS, ...OPTIONS];
const empty = () => Object.fromEntries(FIELDS.map(field => [field, '']));

function writePrivate(path, data) {
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, data, { mode: 0o600 });
  renameSync(temp, path);
  chmodSync(path, 0o600);
}

export function createProviderSettings(directory, safeStorage) {
  const optionsPath = join(directory, 'provider-settings.txt');
  const secretsPath = join(directory, 'provider-secrets.bin');
  let values = empty();
  let legacyPlaintext = false;
  let secureAvailable = false;

  const secureStoreAvailable = async () => {
    secureAvailable = safeStorage.getSelectedStorageBackend() !== 'basic_text'
      && await safeStorage.isAsyncEncryptionAvailable();
    return secureAvailable;
  };

  function apply() {
    for (const field of FIELDS) {
      if (values[field]) process.env[field] = values[field];
      else delete process.env[field];
    }
  }

  function status() {
    return {
      ...Object.fromEntries(OPTIONS.map(field => [field, values[field]])),
      ...Object.fromEntries(KEYS.map(field => [field, Boolean(values[field])])),
      secureStorage: secureAvailable && !legacyPlaintext,
      legacyPlaintext,
    };
  }

  async function load() {
    await secureStoreAvailable();
    const old = existsSync(optionsPath) ? parse(readFileSync(optionsPath)) : {};
    values = { ...empty(), ...Object.fromEntries(FIELDS.map(field => [field, old[field] || ''])) };
    legacyPlaintext = KEYS.some(field => values[field]);
    if (existsSync(secretsPath)) {
      const result = await safeStorage.decryptStringAsync(readFileSync(secretsPath));
      const secrets = JSON.parse(result.result);
      for (const field of KEYS) values[field] = secrets[field] || values[field];
      if (result.shouldReEncrypt) writePrivate(secretsPath, await safeStorage.encryptStringAsync(JSON.stringify(Object.fromEntries(KEYS.map(field => [field, values[field]])))));
    }
    if (legacyPlaintext && await secureStoreAvailable()) await persist();
    apply();
    return status();
  }

  async function persist() {
    if (KEYS.some(field => values[field])) {
      if (!(await secureStoreAvailable())) throw new Error('A system keyring is required to save API keys. Unlock GNOME Keyring or KWallet, then try again.');
      writePrivate(secretsPath, await safeStorage.encryptStringAsync(JSON.stringify(Object.fromEntries(KEYS.map(field => [field, values[field]])))));
    } else if (existsSync(secretsPath)) unlinkSync(secretsPath);
    writePrivate(optionsPath, `${OPTIONS.map(field => `${field}=${JSON.stringify(values[field])}`).join('\n')}\n`);
    legacyPlaintext = false;
    apply();
  }

  async function save(changes) {
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw new Error('Invalid provider settings.');
    const next = { ...values };
    for (const field of FIELDS) {
      if (!(field in changes)) continue;
      const value = changes[field];
      if (typeof value !== 'string' || value.length > 500 || /[\r\n]/.test(value)) throw new Error(`Invalid ${field}.`);
      if (!KEYS.includes(field) || value.trim()) next[field] = value.trim();
    }
    if (changes.clear !== undefined && (!Array.isArray(changes.clear) || changes.clear.some(field => !KEYS.includes(field)))) throw new Error('Invalid key to remove.');
    for (const field of changes.clear || []) next[field] = '';
    const previous = values;
    values = next;
    try { await persist(); }
    catch (error) { values = previous; throw error; }
    return status();
  }

  return { load, save, status };
}
