import { Controller, Get, Param, Query } from '@nestjs/common';
import { InstrumentsService } from './instruments.service';

@Controller('instruments')
export class InstrumentsController {
  constructor(private readonly instrumentsService: InstrumentsService) {}

  @Get()
  getInstruments(
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const parsedLimit = limit ? parseInt(limit, 10) : 20;
    return this.instrumentsService.findAll(parsedLimit, cursor);
  }

  @Get(':symbol')
  getInstrumentBySymbol(@Param('symbol') symbol: string) {
    return this.instrumentsService.findBySymbol(symbol);
  }
}
