import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class AppService {
  constructor(private readonly config: ConfigService) {}

  health() {
    return { status: 'ok', service: 'api' };
  }

  async callLlm(payload: unknown) {
    const llmUrl = this.config.get<string>('LLM_SERVICE_URL');
    const { data } = await axios.post(`${llmUrl}/llm/generate`, payload);
    return data;
  }
}
