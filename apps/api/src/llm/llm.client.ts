import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { env } from '../config/env';

export interface LlmRequest {
  task: 'placement_scoring' | 'roleplay_turn' | 'translation' | 'grammar_check' | 'vocabulary' | 'conversation' | 'pronunciation_feedback';
  system: string;
  prompt: string;
  /** Always set a cap (TRACKER D10). */
  maxTokens: number;
  temperature?: number;
  json?: boolean;
  timeoutMs?: number;
}

export interface LlmResponse {
  text: string;
  provider: string;
  promptTokens: number | null;
  completionTokens: number | null;
}

/** Calls the internal Python LLM service, which picks the provider per task (TASK_ROUTING). */
@Injectable()
export class LlmClient {
  private readonly logger = new Logger('LlmClient');

  async generate(req: LlmRequest): Promise<LlmResponse> {
    const started = Date.now();
    const { data } = await axios.post(
      `${env.llmServiceUrl}/llm/generate`,
      {
        task: req.task,
        system: req.system,
        prompt: req.prompt,
        max_tokens: req.maxTokens,
        temperature: req.temperature ?? 0,
        json_output: req.json ?? false,
      },
      { timeout: req.timeoutMs ?? 20_000 },
    );
    const res: LlmResponse = {
      text: data.result,
      provider: data.provider,
      promptTokens: data.usage?.prompt_tokens ?? null,
      completionTokens: data.usage?.completion_tokens ?? null,
    };
    this.logger.log(
      `task=${req.task} provider=${res.provider} tokens=${res.promptTokens}+${res.completionTokens} ms=${Date.now() - started}`,
    );
    return res;
  }
}
