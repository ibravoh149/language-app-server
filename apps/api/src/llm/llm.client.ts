import { Inject, Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { eq } from 'drizzle-orm';
import { currentUserId } from '../common/request-context';
import { env } from '../config/env';
import { DB, DrizzleDB } from '../database/database.module';
import { llmCalls } from '../database/schema';
import { estimateCostUsd } from './llm-pricing';

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
  /** Id of the recorded call; pass it to markInvalid() if the output turns out unusable. */
  callId: string | null;
}

/** "OllamaProvider" (the Python class name) → "ollama": the stable key stored and shown in the admin. */
export const providerKey = (name: string) => name.replace(/Provider$/, '').toLowerCase();

/** Calls the internal Python LLM service, which picks the provider per task (TASK_ROUTING). */
@Injectable()
export class LlmClient {
  private readonly logger = new Logger('LlmClient');

  constructor(@Inject(DB) private readonly db: DrizzleDB) {}

  /** One bounded call. Every call is recorded in llm_calls (outcome, tokens, latency, cost). */
  async generate(req: LlmRequest): Promise<LlmResponse> {
    const started = Date.now();
    const userId = currentUserId() ?? null;
    let data: { result: string; provider: string; model?: string | null; fallback?: boolean; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    try {
      ({ data } = await axios.post(
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
      ));
    } catch (error) {
      const ms = Date.now() - started;
      const message = describeError(error);
      this.logger.warn(`task=${req.task} failed ms=${ms}: ${message}`);
      await this.record({ task: req.task, provider: null, model: null, outcome: 'error', fallback: false, error: message, promptTokens: null, completionTokens: null, ms, userId });
      throw error;
    }
    const ms = Date.now() - started;
    const res: LlmResponse = {
      text: data.result,
      provider: providerKey(data.provider),
      promptTokens: data.usage?.prompt_tokens ?? null,
      completionTokens: data.usage?.completion_tokens ?? null,
      callId: null,
    };
    this.logger.log(
      `task=${req.task} provider=${res.provider}${data.fallback ? ' (fallback)' : ''} tokens=${res.promptTokens}+${res.completionTokens} ms=${ms}`,
    );
    res.callId = await this.record({
      task: req.task, provider: res.provider, model: data.model ?? null, outcome: 'ok', fallback: !!data.fallback, error: null,
      promptTokens: res.promptTokens, completionTokens: res.completionTokens, ms, userId,
    });
    return res;
  }

  /** The call answered, but its output couldn't be used (e.g. invalid JSON); counts as a failure. */
  async markInvalid(callId: string | null, detail: string) {
    if (!callId) return;
    try {
      await this.db.update(llmCalls).set({ outcome: 'invalid', error: detail.slice(0, 300) }).where(eq(llmCalls.id, callId));
    } catch (error) {
      this.logger.warn(`could not mark call ${callId} invalid: ${describeError(error)}`);
    }
  }

  /** Recording must never break the call itself. */
  private async record(row: Omit<typeof llmCalls.$inferInsert, 'costUsd'>): Promise<string | null> {
    try {
      const costUsd = estimateCostUsd(row.provider ?? null, row.model ?? null, row.promptTokens ?? null, row.completionTokens ?? null);
      const [created] = await this.db.insert(llmCalls).values({ ...row, costUsd }).returning({ id: llmCalls.id });
      return created.id;
    } catch (error) {
      this.logger.warn(`could not record llm call: ${describeError(error)}`);
      return null;
    }
  }
}

function describeError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.detail;
    return (error.response ? `HTTP ${error.response.status}${detail ? `: ${String(detail).slice(0, 200)}` : ''}` : error.code ?? error.message).slice(0, 300);
  }
  return (error instanceof Error ? error.message : String(error)).slice(0, 300);
}
