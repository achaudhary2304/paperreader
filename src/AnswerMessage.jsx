import React from 'react';
import { ExternalLink, Save, Sparkles } from 'lucide-react';
import RichText from './RichText.jsx';

const SWITCH_MESSAGES = {
  provider_fallback: 'The preferred provider failed. The backup provider answered.',
  vision_model: 'Switched to a vision-capable model to read the image.',
  free_model_fallback: 'OpenRouter switched to another verified free model.',
  rate_limit: 'Preferred model hit a rate limit. Switched automatically.',
};
const seconds = (ms) => `${(Number(ms) / 1000).toFixed(2)}s`;

function AnswerTimings({ timings, retrieval }) {
  if (!timings) return null;
  return (
    <details className="answer-timings">
      <summary>
        Timing details ·{' '}
        {seconds(timings.server?.['Server total'] || timings.client?.['Client total'] || 0)}
      </summary>
      <div>
        {Number.isInteger(retrieval?.cachedPapers) && (
          <span>
            Paper text reused<b>{retrieval.cachedPapers} papers</b>
          </span>
        )}
        {['client', 'server'].map((group) =>
          Object.entries(timings[group] || {}).map(([name, ms]) => (
            <span key={`${group}-${name}`}>
              {group === 'client' ? 'Client' : 'Server'} · {name}
              <b>{seconds(ms)}</b>
            </span>
          )),
        )}
        {(timings.inference || []).map((item, index) => (
          <span key={index}>
            {item.stage} · {item.provider}
            {item.outcome === 'error' ? ' · failed' : ''}
            <b>{seconds(item.ms)}</b>
          </span>
        ))}
      </div>
    </details>
  );
}

// Rendering an answer is independent of workspace state. The workspace supplies
// the actions for navigation and saving; this component only displays the result.
export default function AnswerMessage({
  message,
  mode,
  models,
  documents,
  activeDoc,
  docId,
  locationLabel,
  projects,
  notes,
  onCitation,
  onPage,
}) {
  const project = projects.find((item) => item.id === notes.projectId);
  const saved = project?.entries?.some((entry) => entry.messageId === message.id);
  const modelName =
    models.find((item) => item.id === message.model)?.name ||
    message.modelName ||
    message.model ||
    'GPT-OSS 120B';

  return (
    <div className="assistant-message">
      <div className="answer-byline">
        <span className="answer-avatar">
          <Sparkles size={14} fill="currentColor" />
        </span>
        <strong>PaperLens</strong>
        <span>
          · {mode?.short} · {message.provider ? `${message.provider} · ` : ''} {modelName}
        </span>
      </div>
      {message.modelSwitch && (
        <div className="model-switch-note">
          {SWITCH_MESSAGES[message.modelSwitch.reason] ||
            'Preferred model was unavailable. Switched automatically.'}
        </div>
      )}
      {message.agents?.length > 0 && (
        <div className="agent-trail" aria-label="Agents used">
          {message.agents.map((agent) => (
            <span key={agent}>{agent}</span>
          ))}
        </div>
      )}
      <AnswerTimings timings={message.timings} retrieval={message.retrieval} />
      <RichText
        text={message.content}
        evidence={message.evidence}
        documents={documents}
        docId={docId}
        onCitation={onCitation}
      />
      <div className="save-answer-row">
        {notes.showProjectPicker && (
          <select
            aria-label="Choose a project for these notes"
            value={notes.projectId || ''}
            onChange={(event) => notes.onSelectProject(event.target.value)}
          >
            <option value="">Choose project…</option>
            {projects.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        )}
        <button
          onClick={notes.onSave}
          disabled={!notes.projectId || notes.saving || saved}
          title="Save a concise summary to project notes"
        >
          <Save size={13} />{' '}
          {notes.saving ? 'Shortening…' : saved ? 'Saved to notes' : 'Add to project notes'}
        </button>
      </div>
      {notes.error && (
        <div className="note-save-error" role="alert">
          {notes.error}
        </div>
      )}
      {message.evidence?.length > 0 && (
        <div className="evidence-list">
          <strong>Source passages</strong>
          {message.evidence.map((source, index) => (
            <button
              key={`${source.label}:${source.page}:${index}`}
              onClick={() => onCitation(source)}
              title="Jump to this passage"
            >
              <span>
                {source.title || activeDoc.name} ·{' '}
                {documents.find((doc) => doc.id === (source.docId || docId))?.kind === 'article'
                  ? '§'
                  : 'p.'}{' '}
                {source.page}
              </span>
              <q>{source.quote}</q>
            </button>
          ))}
        </div>
      )}
      {!message.evidence?.length && message.paperPages?.length > 0 && (
        <div className="paper-pages">
          <span>
            {message.retrieval
              ? `SEARCHED ${message.retrieval.indexedPages} PAGES · EVIDENCE`
              : 'PAPER CONTEXT'}
          </span>
          {message.paperPages.map((page) => (
            <button key={page} onClick={() => onPage(page)}>
              {locationLabel} {page}
            </button>
          ))}
        </div>
      )}
      {message.sources?.length > 0 && (
        <div className="source-list">
          <strong>Sources explored</strong>
          {message.sources.map((source, index) => (
            <a key={index} href={source.url} target="_blank" rel="noopener noreferrer">
              <span>{source.kind}</span>
              {source.title.length > 44
                ? `${source.title.slice(0, 44).trim()}…`
                : source.title}{' '}
              <ExternalLink size={12} />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
