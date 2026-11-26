// A thread's scope is explicit. Draft questions use the currently selected project.
export function questionProjectId(thread, enabled, selectedProjectId) {
  if (thread) {
    return thread.projectId || '';
  }
  if (enabled) {
    return selectedProjectId || '';
  }
  return '';
}
