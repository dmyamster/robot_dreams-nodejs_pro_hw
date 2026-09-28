import { Injectable, NotFoundException } from '@nestjs/common';

export interface StockInstrument {
  symbol: string;
  company_name: string;
  current_price_cents: number;
  sector: string;
  trading_status: 'ACTIVE' | 'HALTED';
  logo_url: string | null;
}

@Injectable()
export class InstrumentsService {
  private instruments: StockInstrument[] = [
    {
      symbol: 'AAPL',
      company_name: 'Apple Inc.',
      current_price_cents: 22050,
      sector: 'Technology',
      trading_status: 'ACTIVE',
      logo_url: 'https://storage.example.com/logos/aapl.png',
    },
    {
      symbol: 'TSLA',
      company_name: 'Tesla Inc.',
      current_price_cents: 21500,
      sector: 'Automotive',
      trading_status: 'ACTIVE',
      logo_url: null,
    },
    {
      symbol: 'MSFT',
      company_name: 'Microsoft Corp.',
      current_price_cents: 43000,
      sector: 'Technology',
      trading_status: 'ACTIVE',
      logo_url: null,
    },
  ];

  findAll(limit: number = 20, cursor?: string) {
    let startIndex = 0;
    if (cursor) {
      const decoded = parseInt(Buffer.from(cursor, 'base64').toString('utf-8'), 10);
      if (!Number.isNaN(decoded)) {
        startIndex = decoded;
      }
    }

    const items = this.instruments.slice(startIndex, startIndex + limit);
    const nextIndex = startIndex + limit;
    const next_cursor =
      nextIndex < this.instruments.length
        ? Buffer.from(String(nextIndex)).toString('base64')
        : null;

    return { items, next_cursor };
  }

  findBySymbol(symbol: string): StockInstrument {
    const instrument = this.instruments.find((i) => i.symbol === symbol.toUpperCase());
    if (!instrument) {
      throw new NotFoundException(`Instrument with symbol '${symbol}' not found`);
    }
    return instrument;
  }
}
