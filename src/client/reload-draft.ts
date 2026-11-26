export type ReloadDraft = {
  mode: 'youtube' | 'sample' | 'manual';
  url: string;
  transcript: string;
  requirements: string;
  articleId?: string;
};
export const reloadDraftKey = 'recast-reload-draft';
export function readReloadDraft(): ReloadDraft | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(reloadDraftKey) ?? 'null');
    if (
      !value ||
      !['youtube', 'sample', 'manual'].includes(value.mode) ||
      ['url', 'transcript', 'requirements'].some((k) => typeof value[k] !== 'string') ||
      (value.articleId !== undefined && !/^[a-f0-9]{64}$/.test(value.articleId))
    )
      return null;
    return value;
  } catch {
    return null;
  }
}
