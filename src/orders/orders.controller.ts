import {
  Controller,
  Post,
  Get,
  Param,
  Query,
  Body,
  Headers,
  Res,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { OrdersService, CreateOrderDto } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  createOrder(
    @Headers('idempotency-key') idempotencyKey: string,
    @Body() createOrderDto: CreateOrderDto,
    @Res() res: Response,
  ) {
    const result = this.ordersService.create(idempotencyKey, createOrderDto);

    if (result.isReplay) {
      res.setHeader('Idempotency-Replay', 'true');
    }

    return res.status(HttpStatus.CREATED).json(result.order);
  }

  @Get()
  getOrders(
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const parsedLimit = limit ? parseInt(limit, 10) : 20;
    return this.ordersService.findAll(parsedLimit, cursor);
  }

  @Get(':id')
  getOrderById(@Param('id') id: string) {
    return this.ordersService.findById(id);
  }
}
