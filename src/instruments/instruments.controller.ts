import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CreateInstrumentDto, InstrumentsService } from './instruments.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('instruments')
export class InstrumentsController {
  constructor(private readonly instrumentsService: InstrumentsService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'BROKER')
  @HttpCode(HttpStatus.CREATED)
  createInstrument(@Body() dto: CreateInstrumentDto) {
    return this.instrumentsService.create(dto);
  }

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
