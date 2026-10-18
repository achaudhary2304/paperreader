import React from 'react';
import { Check, Highlighter, Trash2, X } from 'lucide-react';

export default function AnnotationEditor({
  annotationDraft,
  onChange,
  projects,
  annotationProjectId,
  onProjectChange,
  locationLabel,
  onClose,
  onSave,
  onDelete,
}) {
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <form className="settings-modal annotation-modal" onSubmit={onSave}>
        <div className="modal-header">
          <span className="modal-icon">
            <Highlighter size={20} />
          </span>
          <button type="button" aria-label="Close annotation" onClick={() => onClose()}>
            <X size={19} />
          </button>
        </div>
        <h2>
          {annotationDraft.id
            ? 'Edit annotation'
            : annotationDraft.kind === 'Comment'
              ? 'Comment on passage'
              : annotationDraft.kind === 'Region'
                ? 'Annotate figure or table'
                : 'Annotate passage'}
        </h2>
        <p className="annotation-quote">
          “{annotationDraft.text}”{' '}
          <span>
            {locationLabel} {annotationDraft.page}
          </span>
        </p>
        <label htmlFor="annotation-note">YOUR NOTE · OPTIONAL</label>
        <textarea
          id="annotation-note"
          autoFocus
          rows={5}
          value={annotationDraft.note}
          onChange={(event) => onChange((current) => ({ ...current, note: event.target.value }))}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder="Your own thought about this passage… (Enter to save, Shift+Enter for a new line)"
        />
        <label htmlFor="annotation-tags">TAGS · COMMA SEPARATED</label>
        <input
          id="annotation-tags"
          value={annotationDraft.tagsText ?? (annotationDraft.tags || []).join(', ')}
          onChange={(event) =>
            onChange((current) => ({ ...current, tagsText: event.target.value }))
          }
          placeholder="method, question, result"
        />
        <div className="annotation-colors" role="group" aria-label="Annotation color">
          {['yellow', 'green', 'blue'].map((color) => (
            <button
              key={color}
              type="button"
              className={`annotation-swatch annotation-${color} ${annotationDraft.color === color ? 'selected' : ''}`}
              onClick={() => onChange((current) => ({ ...current, color }))}
              aria-label={`${color} annotation`}
              aria-pressed={annotationDraft.color === color}
            />
          ))}
        </div>
        {projects.length > 0 && (
          <div className="annotation-project">
            <label htmlFor="annotation-project-select">LINK TO PROJECT NOTES</label>
            <select
              id="annotation-project-select"
              value={annotationProjectId}
              onChange={(event) => onProjectChange(event.target.value)}
            >
              <option value="">Choose project…</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
            <label className="annotation-project-check">
              <input
                type="checkbox"
                checked={Boolean(annotationDraft.linkToProject)}
                disabled={!annotationProjectId}
                onChange={(event) =>
                  onChange((current) => ({ ...current, linkToProject: event.target.checked }))
                }
              />{' '}
              Add this annotation to the project's README notes
            </label>
          </div>
        )}
        <div className="annotation-modal-actions">
          {annotationDraft.id && !annotationDraft.embedded && (
            <button
              type="button"
              className="annotation-delete"
              onClick={() => {
                onDelete();
              }}
            >
              <Trash2 size={15} /> Delete
            </button>
          )}
          <button className="primary-action" type="submit">
            <Check size={15} /> Save annotation · Enter
          </button>
        </div>
      </form>
    </div>
  );
}
