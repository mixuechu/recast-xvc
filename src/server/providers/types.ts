export type AIEnv = {
  AI_PROVIDER: string;
  AI_MODEL: string;
  DEEPSEEK_API_KEY?: string;
  GEMINI_API_KEY?: string;
  ZHIPU_API_KEY?: string;
};
export type ProviderName = 'deepseek' | 'gemini' | 'zhipu';
export type GenerationRequest = {
  system: string;
  prompt: string;
  signal: AbortSignal;
  json?: boolean;
  maxOutputTokens?: number;
};
export interface AIProvider {
  readonly name: ProviderName;
  readonly model: string;
  readonly configured: boolean;
  generate(request: GenerationRequest): AsyncGenerator<string>;
}
