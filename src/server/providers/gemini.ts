import { readGemini } from '../../protocol/gemini';
import { modelError } from '../model-error';
import { requestModel } from '../model-request';
import type { AIProvider, GenerationRequest } from './types';

export class GeminiProvider implements AIProvider {
  readonly name = 'gemini';
  readonly model: string;
  #apiKey?: string;
  constructor(apiKey?: string, model?: string) {
    this.#apiKey = apiKey;
    this.model = model || 'gemini-3.6-flash';
  }
  get configured() {
    return !!this.#apiKey;
  }

  async *generate({
    system,
    prompt,
    signal,
    json = false,
  }: GenerationRequest): AsyncGenerator<string> {
    if (!this.#apiKey) throw new Error('服务端尚未配置模型密钥，请联系部署者。');
    const response = await requestModel(
      'https://generativelanguage.googleapis.com/v1beta/interactions?alt=sse',
      {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.#apiKey,
          'Api-Revision': '2026-05-20',
        },
        body: JSON.stringify({
          model: this.model,
          stream: true,
          store: false,
          system_instruction: system,
          input: prompt,
          generation_config: { max_output_tokens: json ? 6000 : 10000 },
          ...(json ? { response_format: { type: 'text', mime_type: 'application/json' } } : {}),
        }),
      },
      3,
    );
    if (!response.ok) throw await modelError(response, this.name);
    if (!response.body) throw new Error('模型未返回响应。');
    yield* readGemini(response.body, signal);
  }
}
