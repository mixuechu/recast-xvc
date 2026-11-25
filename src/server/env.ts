import type { AIEnv } from './ai';
import type { ArticleSession } from './session/ArticleSession';
import type { TranscriptCache } from './TranscriptCache';
import type { Quota } from './Quota';
export interface Env extends AIEnv {
  ASSETS: Fetcher;
  SESSIONS: DurableObjectNamespace<ArticleSession>;
  SUPADATA_API_KEY?: string;
  TRANSCRIPTS: DurableObjectNamespace<TranscriptCache>;
  QUOTAS: DurableObjectNamespace<Quota>;
  APP_ACCESS_TOKEN?: string;
}
