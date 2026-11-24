import React, { useRef } from 'react';
import { filterLibrary } from './articleFormat.js';
import { ChevronDown, FileText, Folder, FolderMinus, Globe, RefreshCw, X } from 'lucide-react';

function TreePaper({ doc, active, projects, onOpen, onMove, onRemove, onDragStart, onDragEnd }) {
  const getActiveClassName = () => {
    if (active) {
      return 'active';
    }
    return '';
  };

  const getDocKindArticle = () => {
    if (doc.kind === 'article') {
      return 'Article';
    }
    return 'PDF';
  };

  let kindIcon;
  if (doc.kind === 'article') {
    kindIcon = <Globe size={14} />;
  } else {
    kindIcon = <FileText size={14} />;
  }
  const owner = projects.find((project) => project.paperIds?.includes(doc.id))?.id || '';
  return (
    <div
      className={`tree-file ${getActiveClassName()}`}
      role="treeitem"
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData('text/plain', doc.id);
        event.dataTransfer.effectAllowed = 'move';
        onDragStart?.(event);
      }}
      onDragEnd={onDragEnd}
    >
      <button className="tree-file-open" onClick={onOpen} title={doc.name}>
        <span className="tree-file-icon">{kindIcon}</span>
        <span>
          <strong>{doc.name}</strong>
          <small>
            {getDocKindArticle()} · {doc.status || 'unread'}
          </small>
        </span>
      </button>
      <select
        aria-label={`Move ${doc.name} to folder`}
        title="Move to folder"
        value={owner}
        onChange={(event) => onMove(doc.id, event.target.value)}
      >
        <option value="">General</option>
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name}
          </option>
        ))}
      </select>
      {doc.id !== 'sample' && !doc.sourceFolderId && onRemove && (
        <button
          className="tree-file-remove"
          onClick={onRemove}
          title="Remove from library"
          aria-label={`Remove ${doc.name}`}
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
}

function ComputerFolderContents({
  folderId,
  path = '',
  documents,
  openFolders,
  onToggle,
  projects,
  activeDocId,
  onDragStart,
  onDragEnd,
  onOpen,
  onMove,
}) {
  const groupKey = (path) => `computer:${folderId}:${path}`;
  const direct = [];
  const directories = new Set();
  for (const doc of documents) {
    const relativePath = String(doc.sourceRelativePath || doc.name).replaceAll('\\', '/');
    let prefix;
    if (path) {
      prefix = `${path}/`;
    } else {
      prefix = '';
    }
    if (!relativePath.startsWith(prefix)) {
      continue;
    }
    const remainder = relativePath.slice(prefix.length);
    const slash = remainder.indexOf('/');
    if (slash < 0) {
      direct.push(doc);
    } else {
      directories.add(remainder.slice(0, slash));
    }
  }
  return (
    <div className="tree-children" role="group">
      {direct.map((doc) => (
        <TreePaper
          key={doc.id}
          doc={doc}
          active={activeDocId === doc.id}
          onDragStart={() => onDragStart(doc.id)}
          onDragEnd={onDragEnd}
          onOpen={() => onOpen(doc.id)}
          onMove={onMove}
          projects={projects}
        />
      ))}
      {[...directories]
        .sort((a, b) => a.localeCompare(b))
        .map((name) => {
          const getOpenClassName = () => {
            if (open) {
              return '';
            }
            return 'tree-collapsed';
          };

          let childPath;
          if (path) {
            childPath = `${path}/${name}`;
          } else {
            childPath = name;
          }
          const folderKey = groupKey(childPath);
          const open = openFolders[folderKey] !== false;
          const nested = documents.filter((doc) =>
            String(doc.sourceRelativePath || doc.name)
              .replaceAll('\\', '/')
              .startsWith(`${childPath}/`),
          );
          return (
            <div
              className="tree-folder computer-subfolder"
              role="treeitem"
              aria-expanded={open}
              key={folderKey}
            >
              <button onClick={() => onToggle(folderKey)}>
                <ChevronDown size={12} className={getOpenClassName()} />
                <Folder size={13} />
                <span>{name}</span>
                <small>{nested.length}</small>
              </button>
              {open && (
                <ComputerFolderContents
                  folderId={folderId}
                  path={childPath}
                  documents={nested}
                  openFolders={openFolders}
                  onToggle={onToggle}
                  projects={projects}
                  activeDocId={activeDocId}
                  onDragStart={onDragStart}
                  onDragEnd={onDragEnd}
                  onOpen={onOpen}
                  onMove={onMove}
                />
              )}
            </div>
          );
        })}
      {!documents.length && (
        <small className="tree-folder-empty">
          No PDFs found. Rescan this folder to check again.
        </small>
      )}
    </div>
  );
}

export default function LibraryTree({
  documents,
  projects,
  filters,
  folderSources,
  folderSyncBusy,
  folderSyncError,
  projectId,
  activeDocId,
  openFolders,
  onToggle,
  onSelectProject,
  onMove,
  onOpen,
  onRemove,
  onRefreshFolder,
  onForgetFolder,
}) {
  const getProjectIdClassName = () => {
    if (!projectId) {
      return 'selected';
    }
    return '';
  };

  const getOpenFoldersGeneralClassName = () => {
    if (openFolders.general === false) {
      return 'tree-collapsed';
    }
    return '';
  };

  const draggedPaper = useRef(null);
  const projectByPaper = new Map();
  for (const project of projects) {
    for (const paperId of project.paperIds || []) {
      if (!projectByPaper.has(paperId)) {
        projectByPaper.set(paperId, project.id);
      }
    }
  }
  const treeDocs = filterLibrary(documents, projects, filters);
  const docsInFolder = (folderId) =>
    treeDocs.filter((doc) => {
      if (folderId) {
        return projectByPaper.get(doc.id) === folderId;
      } else {
        return (
          !projectByPaper.has(doc.id) &&
          (!doc.sourceFolderId || !folderSources.some((folder) => folder.id === doc.sourceFolderId))
        );
      }
    });
  const docsInComputerFolder = (folderId) =>
    treeDocs.filter((doc) => doc.sourceFolderId === folderId && !projectByPaper.has(doc.id));

  return (
    <div className="file-tree" role="tree" aria-label="Paper library">
      <div
        className={`tree-folder ${getProjectIdClassName()}`}
        role="treeitem"
        aria-expanded={openFolders.general !== false}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          onSelectProject('');
          if (draggedPaper.current) {
            onMove(draggedPaper.current, '');
          }
        }}
      >
        <button
          onClick={() => {
            onToggle('general');
            onSelectProject('');
          }}
        >
          <ChevronDown size={14} className={getOpenFoldersGeneralClassName()} />
          <Folder size={15} />
          <span>General</span>
          <small>{documents.filter((doc) => !projectByPaper.has(doc.id)).length}</small>
        </button>
        {openFolders.general !== false && (
          <div className="tree-children" role="group">
            {docsInFolder('').map((doc) => (
              <TreePaper
                key={doc.id}
                doc={doc}
                active={activeDocId === doc.id}
                onDragStart={() => {
                  draggedPaper.current = doc.id;
                }}
                onDragEnd={() => {
                  draggedPaper.current = '';
                }}
                onOpen={() => onOpen(doc.id)}
                onMove={onMove}
                projects={projects}
                onRemove={() => onRemove(doc.id)}
              />
            ))}
            {folderSources.map((folder) => {
              const getOpenFoldersComputerFolderClassName = () => {
                if (openFolders[`computer:${folder.id}`] === false) {
                  return 'tree-collapsed';
                }
                return '';
              };

              const getFolderSyncBusyClassName = () => {
                if (folderSyncBusy) {
                  return 'spin-refresh';
                }
                return '';
              };
              return (
                <div
                  className="tree-folder computer-folder"
                  key={folder.id}
                  role="treeitem"
                  aria-expanded={openFolders[`computer:${folder.id}`] !== false}
                  onDragOver={(event) => event.stopPropagation()}
                  onDrop={(event) => event.stopPropagation()}
                >
                  <div className="computer-folder-row">
                    <button
                      className="computer-folder-toggle"
                      onClick={() => onToggle(`computer:${folder.id}`)}
                    >
                      <ChevronDown size={13} className={getOpenFoldersComputerFolderClassName()} />
                      <Folder size={14} />
                      <span>{folder.name}</span>
                      <small>{docsInComputerFolder(folder.id).length}</small>
                    </button>
                    <button
                      disabled={folderSyncBusy}
                      onClick={() => onRefreshFolder(folder.id)}
                      title="Scan for new or changed PDFs"
                      aria-label={`Refresh ${folder.name}`}
                    >
                      <RefreshCw size={13} className={getFolderSyncBusyClassName()} />
                    </button>
                    <button
                      onClick={() => onForgetFolder(folder.id)}
                      title="Remove folder link; keep imported PDFs"
                      aria-label={`Remove ${folder.name} folder link`}
                    >
                      <FolderMinus size={14} />
                    </button>
                  </div>
                  {openFolders[`computer:${folder.id}`] !== false && (
                    <ComputerFolderContents
                      folderId={folder.id}
                      documents={docsInComputerFolder(folder.id)}
                      openFolders={openFolders}
                      onToggle={onToggle}
                      projects={projects}
                      activeDocId={activeDocId}
                      onDragStart={(id) => {
                        draggedPaper.current = id;
                      }}
                      onDragEnd={() => {
                        draggedPaper.current = '';
                      }}
                      onOpen={onOpen}
                      onMove={onMove}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {projects.map((project) => {
        const getProjectIdProjectIdClassName = () => {
          if (project.id === projectId) {
            return 'selected';
          }
          return '';
        };

        const getOpenFoldersProjectIdClassName = () => {
          if (openFolders[project.id] === false) {
            return 'tree-collapsed';
          }
          return '';
        };
        return (
          <div
            className={`tree-folder ${getProjectIdProjectIdClassName()}`}
            key={project.id}
            role="treeitem"
            aria-expanded={openFolders[project.id] !== false}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              onSelectProject(project.id);
              if (draggedPaper.current) {
                onMove(draggedPaper.current, project.id);
              }
            }}
          >
            <button
              onClick={() => {
                onToggle(project.id);
                onSelectProject(project.id, true);
              }}
            >
              <ChevronDown size={14} className={getOpenFoldersProjectIdClassName()} />
              <Folder size={15} />
              <span>{project.name}</span>
              <small>{(project.paperIds || []).length}</small>
            </button>
            {openFolders[project.id] !== false && (
              <div className="tree-children" role="group">
                {docsInFolder(project.id).map((doc) => (
                  <TreePaper
                    key={doc.id}
                    doc={doc}
                    active={activeDocId === doc.id}
                    draggable
                    onDragStart={() => {
                      draggedPaper.current = doc.id;
                    }}
                    onDragEnd={() => {
                      draggedPaper.current = '';
                    }}
                    onOpen={() => onOpen(doc.id)}
                    onMove={onMove}
                    projects={projects}
                    onRemove={() => onRemove(doc.id)}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
      {folderSyncError && (
        <p className="folder-sync-error" role="alert">
          {folderSyncError}
        </p>
      )}
      {treeDocs.length === 0 && (
        <p className="annotation-empty">
          No matching reading. Change your filters or add a paper or article.
        </p>
      )}
    </div>
  );
}
