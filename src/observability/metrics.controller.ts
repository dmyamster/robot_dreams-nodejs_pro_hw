import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { metricsRegistry } from './metrics';

@Controller()
export class MetricsController {
  @Get('metrics')
  async getMetrics(@Res() res: Response): Promise<void> {
    res.setHeader('Content-Type', metricsRegistry.contentType);
    res.send(await metricsRegistry.metrics());
  }
}
