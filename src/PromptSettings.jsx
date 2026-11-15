import React from 'react';
import { DEFAULT_PROMPTS } from './defaultPrompts.js';

const LABELS = {
  explain: 'Explain',
  concept: 'Concept',
  math: 'Math',
  literature: 'Related papers',
  search: 'Search',
};

export default function PromptSettings({ prompts, onChange }) {
  return (
    <>
      <p>
        Choose the starting question for each action. You can still edit it in chat before sending.
        Changes save automatically.
      </p>
      {Object.entries(DEFAULT_PROMPTS).map(([mode, fallback]) => (
        <div className="prompt-setting" key={mode}>
          <label htmlFor={`default-prompt-${mode}`}>{LABELS[mode]}</label>
          <textarea
            id={`default-prompt-${mode}`}
            rows={3}
            value={prompts[mode] ?? fallback}
            placeholder={fallback}
            onChange={(event) => onChange({ ...prompts, [mode]: event.target.value })}
          />
        </div>
      ))}
      <button type="button" className="text-action" onClick={() => onChange({})}>
        Reset to default prompts
      </button>
    </>
  );
}
