export function formatTime(seconds: number): string {
  if (isNaN(seconds)) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

export function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

export function parseCommand(raw: string): { cmdName: string; args: string[] } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(/\s+/);
  return { cmdName: parts[0].toLowerCase(), args: parts.slice(1) };
}

export function getFileName(filePath: string): string {
  return filePath.split(/[/\\]/).pop() || filePath;
}
