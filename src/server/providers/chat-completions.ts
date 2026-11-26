import { readChatCompletions } from '../../protocol/chat-completions';
import { modelError } from '../model-error';
import { requestModel } from '../model-request';
import type { AIProvider, GenerationRequest } from './types';

type Settings = {
  name: 'deepseek' | 'zhipu';
  endpoint: string;
  model: string;
  apiKey?: string;
};
// DeepSeek and Zhipu share a wire protocol, while each concrete class fixes its own endpoint.
abstract class ChatCompletionsProvider implements AIProvider {
  #settings: Settings;
  protected constructor(settings: Settings) {
    this.#settings = settings;
  }
  get name() {
    return this.#settings.name;
  }
  get model() {
    return this.#settings.model;
  }
  get configured() {
    return !!this.#settings.apiKey;
  }

  async *generate({
    system,
    prompt,
    signal,
    json = false,
    maxOutputTokens,
  }: GenerationRequest): AsyncGenerator<string> {
    const { apiKey, endpoint } = this.#settings;
    if (!apiKey) throw new Error('服务端尚未配置模型密钥，请联系部署者。');
    const response = await requestModel(endpoint, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: this.model,
        stream: true,
        thinking: { type: 'disabled' },
        temperature: 0.4,
        max_tokens: maxOutputTokens ?? (json ? 2400 : 10000),
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
        ...(json ? { response_format: { type: 'json_object' } } : {}),
      }),
    });
    if (!response.ok) throw await modelError(response, this.name);
    if (!response.body) throw new Error('模型未返回响应。');
    yield* readChatCompletions(response.body, signal);
  }
}

export class DeepSeekProvider extends ChatCompletionsProvider {
  constructor(apiKey?: string, model?: string) {
    super({
      name: 'deepseek',
      endpoint: 'https://api.deepseek.com/chat/completions',
      model: model || 'deepseek-flash',
      apiKey,
    });
  }
}

export class ZhipuProvider extends ChatCompletionsProvider {
  constructor(apiKey?: string, model?: string) {
    super({
      name: 'zhipu',
      endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
      model: model || 'glm-4.7',
      apiKey,
    });
  }
}
