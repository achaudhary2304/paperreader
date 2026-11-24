import PromptSettings from './PromptSettings.jsx';
import React, { useEffect, useState } from 'react';
import { ArrowRight, Check, Settings2, X } from 'lucide-react';
import Appearance from './Appearance.jsx';
import UpdateSettings from './UpdateSettings.jsx';

function SettingsTabs({ tab, onChange, desktop = false }) {
  const getDesktop = () => {
    if (desktop) {
      return [['updates', 'Updates']];
    }
    return [];
  };

  const tabs = [
    ['appearance', 'Appearance'],
    ['providers', 'AI providers'],
    ['prompts', 'Prompts'],
    ...getDesktop(),
  ];
  return (
    <div className="settings-tabs" role="tablist" aria-label="Settings sections">
      {tabs.map(([id, label], index) => {
        const getTabIdTabIndex = () => {
          if (tab === id) {
            return 0;
          }
          return -1;
        };
        return (
          <button
            key={id}
            id={`settings-tab-${id}`}
            role="tab"
            aria-selected={tab === id}
            aria-controls={`settings-panel-${id}`}
            tabIndex={getTabIdTabIndex()}
            onClick={() => onChange(id)}
            onKeyDown={(event) => {
              let next;
              if (event.key === 'ArrowRight') {
                next = (index + 1) % tabs.length;
              }
              if (event.key === 'ArrowLeft') {
                next = (index + tabs.length - 1) % tabs.length;
              }
              if (event.key === 'Home') {
                next = 0;
              }
              if (event.key === 'End') {
                next = tabs.length - 1;
              }
              if (next !== undefined) {
                event.preventDefault();
                onChange(tabs[next][0]);
                document.getElementById(`settings-tab-${tabs[next][0]}`).focus();
              }
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function SettingsPanel({ id, tab, children }) {
  return (
    <section
      className="settings-panel"
      role="tabpanel"
      id={`settings-panel-${id}`}
      aria-labelledby={`settings-tab-${id}`}
      hidden={tab !== id}
    >
      {children}
    </section>
  );
}

function InferencePreferences({
  providerPriority,
  setProviderPriority,
  groqModel,
  setGroqModel,
  groqModels,
  customProvider,
}) {
  const getCustomProviderTitle = () => {
    if (customProvider) {
      return 'The configured custom endpoint takes priority';
    }
    return 'Choose which provider to try first';
  };

  return (
    <>
      <label htmlFor="provider-priority" className="model-label">
        TRY FIRST
      </label>
      <select
        id="provider-priority"
        value={providerPriority}
        disabled={customProvider}
        title={getCustomProviderTitle()}
        onChange={(event) => setProviderPriority(event.target.value)}
      >
        <option value="groq">Groq → OpenRouter free</option>
        <option value="openrouter">OpenRouter free → Groq</option>
      </select>
      <label htmlFor="preferred-groq-model" className="model-label">
        GROQ MODEL
      </label>
      <select
        id="preferred-groq-model"
        value={groqModel}
        onChange={(event) => setGroqModel(event.target.value)}
      >
        {groqModels.map((model) => (
          <option key={model.id} value={model.id}>
            {model.name}
          </option>
        ))}
      </select>
      <p className="model-help">
        Provider order and Groq model are saved automatically. A configured custom endpoint takes
        priority.
      </p>
    </>
  );
}

export default function ProviderSettings({
  initialTab = 'appearance',
  onClose,
  onSaved,
  answerModel,
  setAnswerModel,
  availableAnswerModels,
  inferencePreferences,
  promptPreferences,
  freeOnlyMode,
  freeUsage,
  refreshFreeUsage,
}) {
  const renderFreeUsage = () => {
    if (freeUsage) {
      return (
        <>
          <strong>
            {freeUsage.remaining} of {freeUsage.limit}
          </strong>{' '}
          free requests left today
        </>
      );
    }
    return 'Free request count unavailable';
  };

  const getBusy = () => {
    if (busy) {
      return 'Saving…';
    }
    return 'Save settings';
  };

  function renderKeyStorageStatus() {
    if (saved?.secureStorage) {
      return (
        <>
          <Check size={15} /> Keys are protected by your operating system.
        </>
      );
    }
    if (saved?.legacyPlaintext) {
      return 'Older keys are still in a local settings file. Unlock your system keyring to migrate them.';
    }
    return 'Protected system storage is needed to save new keys.';
  }

  const [tab, setTab] = useState(initialTab);
  const [saved, setSaved] = useState(null);
  const [form, setForm] = useState({});
  const [clear, setClear] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    window.paperlensDesktop
      .getProviderSettings()
      .then((data) => {
        setSaved(data);
        setForm(
          Object.fromEntries(
            ['LLM_BASE_URL', 'LLM_MODEL', 'LLM_VISION_MODEL', 'LLM_PROVIDER_NAME'].map((field) => [
              field,
              data[field] || '',
            ]),
          ),
        );
      })
      .catch((e) => {
        setError(e.message);
        setTab('providers');
      });
  }, []);
  const field = (name, label, placeholder, secret = false) => {
    const getSecretType = () => {
      if (secret) {
        return 'password';
      }
      return 'text';
    };

    const getSecretSavedNameClearPlaceholder = () => {
      if (secret && saved?.[name] && !clear.includes(name)) {
        return 'Saved locally · enter a new key to replace';
      }
      return placeholder;
    };

    const getClearName = () => {
      if (clear.includes(name)) {
        return 'Undo';
      }
      return 'Remove';
    };
    return (
      <div className="provider-field" key={name}>
        <label htmlFor={name}>{label}</label>
        <div className="provider-field-row">
          <input
            id={name}
            type={getSecretType()}
            autoComplete="off"
            placeholder={getSecretSavedNameClearPlaceholder()}
            value={form[name] || ''}
            onChange={(event) => {
              setForm((current) => ({ ...current, [name]: event.target.value }));
              setClear((current) => current.filter((item) => item !== name));
            }}
          />
          {secret && saved?.[name] && (
            <button
              type="button"
              onClick={() => {
                setForm((current) => ({ ...current, [name]: '' }));
                setClear((current) => {
                  if (current.includes(name)) {
                    return current.filter((item) => item !== name);
                  } else {
                    return [...current, name];
                  }
                });
              }}
            >
              {getClearName()}
            </button>
          )}
        </div>
        {secret && clear.includes(name) && <small>This key will be removed when you save.</small>}
      </div>
    );
  };
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const data = await window.paperlensDesktop.saveProviderSettings({
        ...form,
        clear,
      });
      setSaved(data);
      setForm((current) => ({
        ...current,
        OPENROUTER_API_KEY: '',
        GROQ_API_KEY: '',
        LLM_API_KEY: '',
      }));
      setClear([]);
      await onSaved();
      onClose();
    } catch (e) {
      setError(e.message || 'Could not save provider settings.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        className="settings-modal provider-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
      >
        <div className="modal-header">
          <span className="modal-icon">
            <Settings2 size={19} />
          </span>
          <button onClick={onClose} aria-label="Close settings">
            <X size={19} />
          </button>
        </div>
        <h2>Settings</h2>
        <p>Reading preferences, AI providers, and app updates.</p>
        <SettingsTabs tab={tab} onChange={setTab} desktop />
        <SettingsPanel id="appearance" tab={tab}>
          <Appearance embedded />
        </SettingsPanel>
        <SettingsPanel id="prompts" tab={tab}>
          <PromptSettings {...promptPreferences} />
        </SettingsPanel>
        <SettingsPanel id="providers" tab={tab}>
          {field('OPENROUTER_API_KEY', 'OPENROUTER KEY · FREE MODELS', 'sk-or-v1-…', true)}
          {field('GROQ_API_KEY', 'GROQ KEY', 'gsk_…', true)}
          <details className="custom-provider-fields">
            <summary>Other OpenAI-compatible API or local model</summary>
            {field('LLM_BASE_URL', 'BASE URL', 'https://api.example.com/v1')}
            {field('LLM_MODEL', 'MODEL', 'model-name')}
            {field('LLM_API_KEY', 'API KEY', 'Optional for a local model', true)}
            {field('LLM_VISION_MODEL', 'VISION MODEL · OPTIONAL', 'vision-model-name')}
            {field('LLM_PROVIDER_NAME', 'PROVIDER NAME · OPTIONAL', 'Custom API')}
          </details>
          <div className="key-status">{renderKeyStorageStatus()}</div>
          {freeOnlyMode && (
            <div className="free-usage">
              <span>{renderFreeUsage()}</span>
              <button onClick={refreshFreeUsage} type="button">
                Refresh
              </button>
            </div>
          )}
          <InferencePreferences {...inferencePreferences} />
          <label htmlFor="desktop-answer-model" className="model-label">
            ANSWER MODEL
          </label>
          <select
            id="desktop-answer-model"
            value={answerModel}
            onChange={(event) => setAnswerModel(event.target.value)}
          >
            {availableAnswerModels.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          {error && (
            <div className="import-error" role="alert">
              {error}
            </div>
          )}
          <div className="modal-actions">
            <span className="provider-save-note">Saved keys remain across app restarts.</span>
            <button className="primary-action" disabled={busy || !saved} onClick={save}>
              {getBusy()} <ArrowRight size={16} />
            </button>
          </div>
        </SettingsPanel>
        <SettingsPanel id="updates" tab={tab}>
          <UpdateSettings />
        </SettingsPanel>
      </div>
    </div>
  );
}

export function BrowserProviderSettings({
  initialTab = 'appearance',
  onClose,
  customProvider,
  freeOnlyMode,
  serverKey,
  apiKey,
  setApiKey,
  freeUsage,
  refreshFreeUsage,
  answerModel,
  setAnswerModel,
  availableAnswerModels,
  inferencePreferences,
  promptPreferences,
}) {
  const getInitialTabUpdates = () => {
    if (initialTab === 'updates') {
      return 'appearance';
    }
    return initialTab;
  };

  const getFreeOnlyMode = () => {
    if (freeOnlyMode) {
      return 'GROQ FALLBACK KEY (OPTIONAL)';
    }
    return 'GROQ API KEY';
  };

  const renderFreeUsage2 = () => {
    if (freeUsage) {
      return (
        <>
          <strong>
            {freeUsage.remaining} of {freeUsage.limit}
          </strong>{' '}
          free requests left today
        </>
      );
    }
    return 'Free request count unavailable';
  };

  function getProviderDescription() {
    if (customProvider) {
      return 'This server uses the OpenAI-compatible endpoint configured in its .env file. Change LLM_BASE_URL and LLM_MODEL there to switch providers.';
    }
    if (freeOnlyMode) {
      return 'OpenRouter is configured on your local server. Choose provider priority below. OpenRouter requests are restricted to free models; Groq is available when its key is configured.';
    }
    return 'Use your Groq API key to power the research paths. The key stays in this browser session and is sent to your local server for inference.';
  }

  function renderKeyStatus() {
    if (customProvider) {
      return (
        <>
          <Check size={15} /> Custom API configured on this server.
        </>
      );
    }
    if (freeOnlyMode) {
      return (
        <>
          <Check size={15} /> OpenRouter free models available · provider priority is configurable.
        </>
      );
    }
    if (serverKey && !apiKey) {
      return (
        <>
          <Check size={15} /> Server key is configured. You’re ready to ask.
        </>
      );
    }
    if (apiKey) {
      return (
        <>
          <Check size={15} /> Session key ready. You’re ready to ask.
        </>
      );
    }
    return 'Get a key from console.groq.com/keys.';
  }

  function getModelHelp() {
    if (customProvider) {
      return 'Change the model in your server .env file. Set LLM_VISION_MODEL separately in the server environment to enable image questions.';
    }
    if (freeOnlyMode) {
      return 'OpenRouter uses verified free models with a zero-price cap. Choose provider order and your preferred Groq model above. The answer shows which provider responded.';
    }
    return 'Preferred model for answers and math. Switches to another available Groq model on rate limits.';
  }

  const [tab, setTab] = useState(getInitialTabUpdates());
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="settings-modal" role="dialog" aria-modal="true" aria-label="Settings">
        <div className="modal-header">
          <span className="modal-icon">
            <Settings2 size={19} />
          </span>
          <button onClick={onClose} aria-label="Close settings">
            <X size={19} />
          </button>
        </div>
        <h2>Settings</h2>
        <SettingsTabs tab={tab} onChange={setTab} />
        <SettingsPanel id="appearance" tab={tab}>
          <Appearance embedded />
        </SettingsPanel>
        <SettingsPanel id="prompts" tab={tab}>
          <PromptSettings {...promptPreferences} />
        </SettingsPanel>
        <SettingsPanel id="providers" tab={tab}>
          <p>{getProviderDescription()}</p>
          <label htmlFor="groq-key" hidden={customProvider}>
            {getFreeOnlyMode()}
          </label>
          <input
            id="groq-key"
            type="password"
            hidden={customProvider}
            placeholder="gsk_..."
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value.trim())}
          />
          <div className="key-status">{renderKeyStatus()}</div>
          {freeOnlyMode && (
            <div className="free-usage">
              <span>{renderFreeUsage2()}</span>
              <button onClick={refreshFreeUsage} type="button">
                Refresh
              </button>
            </div>
          )}
          <InferencePreferences {...inferencePreferences} />
          <label htmlFor="answer-model" className="model-label">
            ANSWER MODEL
          </label>
          <select
            id="answer-model"
            value={answerModel}
            onChange={(event) => setAnswerModel(event.target.value)}
          >
            {availableAnswerModels.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <p className="model-help">
            {getModelHelp()} The actual provider and model are shown on each answer.
          </p>
          <div className="modal-actions">
            <button
              className="text-action"
              hidden={freeOnlyMode || customProvider}
              onClick={() => {
                setApiKey('');
                onClose();
              }}
            >
              Clear key
            </button>
            <button className="primary-action" onClick={onClose}>
              Done <ArrowRight size={16} />
            </button>
          </div>
        </SettingsPanel>
      </div>
    </div>
  );
}
