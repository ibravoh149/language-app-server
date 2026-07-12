import { Controller, Get, Post, Body, Res } from '@nestjs/common';
import { Response } from 'express';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('health')
  health() {
    return this.appService.health();
  }

  @Post('llm/generate')
  async generate(@Body() body: unknown) {
    return this.appService.callLlm(body);
  }

  @Post('llm/stream')
  async stream(@Body() body: unknown, @Res() res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const stream = await this.appService.streamLlm(body);
    stream.pipe(res);

    res.on('close', () => stream.destroy());
  }
}
