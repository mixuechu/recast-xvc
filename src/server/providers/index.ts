import { DeepSeekProvider, ZhipuProvider } from './chat-completions';
import { GeminiProvider } from './gemini';
import type { AIEnv, AIProvider } from './types';
export { DeepSeekProvider, ZhipuProvider, GeminiProvider };
export type { AIEnv, AIProvider, GenerationRequest } from './types';

export function createProvider(env: AIEnv): AIProvider {
  switch (env.AI_PROVIDER) {
    case 'deepseek':
      return new DeepSeekProvider(env.DEEPSEEK_API_KEY, env.AI_MODEL);
    case 'gemini':
      return new GeminiProvider(env.GEMINI_API_KEY, env.AI_MODEL);
    case 'zhipu':
      return new ZhipuProvider(env.ZHIPU_API_KEY, env.AI_MODEL);
    default:
      throw new Error('模型服务配置无效，请检查 AI_PROVIDER。');
  }
}
