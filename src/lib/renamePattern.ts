/**
 * Apply a bulk-rename pattern to one file name. Mirrors the tokens the backend
 * understands: {name} (stem), {index} (zero-padded to 3), {date}, {ext}.
 * If the result has no extension but the source did, the original extension is
 * re-appended. Pure — used by the live preview and unit-tested.
 */
export function applyRenamePattern(fullName: string, pattern: string, index: number, date: string): string {
  const dotIdx = fullName.lastIndexOf(".");
  const stem = dotIdx > 0 ? fullName.slice(0, dotIdx) : fullName;
  const ext = dotIdx > 0 ? fullName.slice(dotIdx + 1) : "";

  let newName = pattern
    .replace(/\{name\}/g, stem)
    .replace(/\{index\}/g, String(index).padStart(3, "0"))
    .replace(/\{date\}/g, date)
    .replace(/\{ext\}/g, ext);

  if (!newName.includes(".") && ext) {
    newName = `${newName}.${ext}`;
  }

  return newName;
}
