import React, { useEffect, useState } from 'react';
import { ArrowRight, Check, Settings2, X } from 'lucide-react';
import Appearance from './Appearance.jsx';

export default function ProviderSettings({
  onClose,
  onSaved,
  answerModel,
  setAnswerModel,
  availableAnswerModels,
  freeOnlyMode,
  freeUsage,
  refreshFreeUsage,
}) {
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
      .catch((e) => setError(e.message));
  }, []);
  const field = (name, label, placeholder, secret = false) => (
    <div className="provider-field" key={name}>
      <label htmlFor={name}>{label}</label>
      <div className="provider-field-row">
        <input
          id={name}
          type={secret ? 'password' : 'text'}
          autoComplete="off"
          placeholder={
            secret && saved?.[name] && !clear.includes(name)
              ? 'Saved locally · enter a new key to replace'
              : placeholder
          }
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
              setClear((current) =>
                current.includes(name)
                  ? current.filter((item) => item !== name)
                  : [...current, name],
              );
            }}
          >
            {clear.includes(name) ? 'Undo' : 'Remove'}
          </button>
        )}
      </div>
      {secret && clear.includes(name) && <small>This key will be removed when you save.</small>}
    </div>
  );
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
        <p>Manage AI providers and choose how PaperReader looks on this computer.</p>
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
        <div className="key-status">
          {saved?.secureStorage ? (
            <>
              <Check size={15} /> Keys are protected by the system keyring.
            </>
          ) : saved?.legacyPlaintext ? (
            'Older keys are still in a local settings file. Unlock your system keyring to migrate them.'
          ) : (
            'A system keyring is needed to save new keys.'
          )}
        </div>
        {freeOnlyMode && (
          <div className="free-usage">
            <span>
              {freeUsage ? (
                <>
                  <strong>
                    {freeUsage.remaining} of {freeUsage.limit}
                  </strong>{' '}
                  free requests left today
                </>
              ) : (
                'Free request count unavailable'
              )}
            </span>
            <button onClick={refreshFreeUsage} type="button">
              Refresh
            </button>
          </div>
        )}
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
            {busy ? 'Saving…' : 'Save settings'} <ArrowRight size={16} />
          </button>
        </div>
        <Appearance embedded />
      </div>
    </div>
  );
}

export function BrowserProviderSettings({
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
}) {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="settings-modal">
        <div className="modal-header">
          <span className="modal-icon">
            <Settings2 size={19} />
          </span>
          <button onClick={onClose}>
            <X size={19} />
          </button>
        </div>
        <h2>
          {customProvider
            ? 'Custom API'
            : freeOnlyMode
              ? 'OpenRouter · Free models'
              : 'Connect Groq'}
        </h2>
        <p>
          {customProvider
            ? 'This server uses the OpenAI-compatible endpoint configured in its .env file. Change LLM_BASE_URL and LLM_MODEL there to switch providers.'
            : freeOnlyMode
              ? 'OpenRouter is configured on your local server. Choose provider priority beside the question box. OpenRouter requests are restricted to free models; Groq is available when its key is configured.'
              : 'Use your Groq API key to power the research paths. The key stays in this browser session and is sent to your local server for inference.'}
        </p>
        <label htmlFor="groq-key" hidden={customProvider}>
          {freeOnlyMode ? 'GROQ FALLBACK KEY (OPTIONAL)' : 'GROQ API KEY'}
        </label>
        <input
          id="groq-key"
          type="password"
          hidden={customProvider}
          placeholder="gsk_..."
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value.trim())}
        />
        <div className="key-status">
          {customProvider ? (
            <>
              <Check size={15} /> Custom API configured on this server.
            </>
          ) : freeOnlyMode ? (
            <>
              <Check size={15} /> OpenRouter free models available · provider priority is
              configurable.
            </>
          ) : serverKey && !apiKey ? (
            <>
              <Check size={15} /> Server key is configured. You’re ready to ask.
            </>
          ) : apiKey ? (
            <>
              <Check size={15} /> Session key ready. You’re ready to ask.
            </>
          ) : (
            'Get a key from console.groq.com/keys.'
          )}
        </div>
        {freeOnlyMode && (
          <div className="free-usage">
            <span>
              {freeUsage ? (
                <>
                  <strong>
                    {freeUsage.remaining} of {freeUsage.limit}
                  </strong>{' '}
                  free requests left today
                </>
              ) : (
                'Free request count unavailable'
              )}
            </span>
            <button onClick={refreshFreeUsage} type="button">
              Refresh
            </button>
          </div>
        )}
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
          {customProvider
            ? 'Change the model in your server .env file. Set LLM_VISION_MODEL separately in the server environment to enable image questions.'
            : freeOnlyMode
              ? 'OpenRouter uses verified free models with a zero-price cap. Choose provider order and your preferred Groq model beside the question box. The answer shows which provider responded.'
              : 'Preferred model for answers and math. Switches to another available Groq model on rate limits.'}{' '}
          The actual provider and model are shown on each answer.
        </p>
        <Appearance embedded />
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
      </div>
    </div>
  );
}
