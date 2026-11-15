import React, { useState } from 'react';
import {
  ArrowDownToLine,
  ChevronDown,
  Layers3,
  Ellipsis,
  Share2,
  StickyNote,
  UploadCloud,
  X,
} from 'lucide-react';
import RichText from './RichText.jsx';

export default function ProjectNotesPanel({
  project,
  documents,
  open,
  answersOpen,
  busy,
  onToggle,
  onToggleAnswers,
  onShare,
  onImport,
  onDownload,
  onManage,
  onChange,
  onRemoveEntry,
  onOpenAnnotation,
}) {
  const [actionsOpen, setActionsOpen] = useState(false);
  return (
    <section className="project-notes-panel">
      <div className="project-notes-heading">
        <button onClick={() => onToggle()} aria-expanded={open}>
          <StickyNote size={14} /> Notes{' '}
          <ChevronDown size={13} className={open ? '' : 'notes-collapsed'} />
        </button>
        {open && (
          <button
            type="button"
            className="notes-actions-toggle"
            aria-label="Project note actions"
            title="Project note actions"
            aria-expanded={actionsOpen}
            onClick={() => setActionsOpen((value) => !value)}
          >
            <Ellipsis size={18} />
          </button>
        )}
      </div>
      {open && (
        <>
          {actionsOpen && (
            <div className="project-note-actions" onClick={() => setActionsOpen(false)}>
              <button
                onClick={onShare}
                disabled={busy}
                title="Export project with papers, annotations and README notes"
                aria-label="Export project"
              >
                <Share2 size={14} /> Share
              </button>
              <button
                onClick={() => onImport()}
                title="Import a shared project"
                aria-label="Import project"
              >
                <UploadCloud size={14} /> Import
              </button>
              <button
                onClick={() => onDownload()}
                title="Download project README.md"
                aria-label="Download project README.md"
              >
                <ArrowDownToLine size={14} /> Export notes
              </button>
              <button
                onClick={() => onManage()}
                title="Manage reading in project"
                aria-label="Manage reading in project"
              >
                <Layers3 size={14} /> Manage papers
              </button>
            </div>
          )}
          <textarea
            rows={3}
            aria-label={`${project.name} project notes`}
            value={project.notes || ''}
            onChange={(event) => onChange(event.target.value)}
            placeholder={`Your own notes for ${project.name}…`}
          />
          {(project.entries || []).length > 0 && (
            <div className="project-saved-answers">
              <button
                className="saved-answers-toggle"
                onClick={() => onToggleAnswers()}
                aria-expanded={answersOpen}
              >
                <ChevronDown size={13} className={answersOpen ? '' : 'notes-collapsed'} /> SAVED
                ANSWERS · {project.entries.length}
              </button>
              {answersOpen &&
                project.entries.map((entry) => (
                  <article key={entry.id} className="project-note-entry">
                    <div>
                      <span>
                        {documents.find((doc) => doc.id === entry.paperId)?.name || 'Document'} ·{' '}
                        {documents.find((doc) => doc.id === entry.paperId)?.kind === 'article'
                          ? '§'
                          : 'p.'}{' '}
                        {entry.page}
                      </span>
                      <button
                        aria-label="Remove saved answer"
                        title="Remove saved answer"
                        onClick={() => onRemoveEntry(entry.id)}
                      >
                        <X size={12} />
                      </button>
                    </div>
                    <b>{entry.question}</b>
                    {entry.annotationId && (
                      <button className="note-source-link" onClick={() => onOpenAnnotation(entry)}>
                        Open annotation · p. {entry.page}
                      </button>
                    )}
                    <RichText className="project-note-summary" text={entry.summary} />
                  </article>
                ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
