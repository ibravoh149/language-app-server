import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as FormData from 'form-data';
import { Readable } from 'stream';

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

  async streamLlm(payload: unknown): Promise<Readable> {
    const llmUrl = this.config.get<string>('LLM_SERVICE_URL');
    const { data } = await axios.post(`${llmUrl}/llm/stream`, payload, {
      responseType: 'stream',
    });
    return data;
  }

  async transcribeAudio(fileBuffer: Buffer, mimetype: string, language?: string, wordTimestamps = false) {
    const audioUrl = this.config.get<string>('AUDIO_SERVICE_URL');
    const form = new FormData();
    form.append('file', fileBuffer, { contentType: mimetype, filename: 'audio.wav' });
    if (language) form.append('language', language);
    form.append('word_timestamps', String(wordTimestamps));
    const { data } = await axios.post(`${audioUrl}/stt/transcribe`, form, {
      headers: form.getHeaders(),
    });
    return data;
  }

  async synthesizeSpeech(payload: { text: string; voice?: string; lang_code?: string; speed?: number }) {
    const audioUrl = this.config.get<string>('AUDIO_SERVICE_URL');
    const { data } = await axios.post(`${audioUrl}/tts/synthesize`, payload, {
      responseType: 'arraybuffer',
    });
    return data;
  }

  async listVoices() {
    const audioUrl = this.config.get<string>('AUDIO_SERVICE_URL');
    const { data } = await axios.get(`${audioUrl}/tts/voices`);
    return data;
  }
}
