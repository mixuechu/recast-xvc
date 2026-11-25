import type { MediaGatewayEnv } from './media-gateway';
import type { AIEnv } from './ai';
import type { RecognitionEnv } from './recognition';
import type { ArticleSession } from './session/ArticleSession';
import type { TranscriptCache } from './TranscriptCache';
import type { Quota } from './Quota';
export interface Env extends AIEnv, RecognitionEnv, MediaGatewayEnv {
  ASSETS: Fetcher;
  SESSIONS: DurableObjectNamespace<ArticleSession>;
  SUPADATA_API_KEY?: string;
  TRANSCRIPTS: DurableObjectNamespace<TranscriptCache>;
  QUOTAS: DurableObjectNamespace<Quota>;
  APP_ACCESS_TOKEN?: string;
  PUBLIC_BASE_URL?: string;
}
