import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Query,
  Body,
  Headers,
  Res,
  Req,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { OrdersService, CreateOrderDto } from './orders.service';
import { OrderEventsService, OrderStatusEvent } from './order-events.service';

@Controller('orders')
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly orderEventsService: OrderEventsService,
  ) {}

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

  @Get(':id/events')
  getOrderEvents(
    @Param('id') id: string,
    @Headers('last-event-id') lastEventIdHeader: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof (res as any).flushHeaders === 'function') {
      (res as any).flushHeaders();
    }

    res.write('retry: 1000\n\n');

    const rawLastId =
      lastEventIdHeader ??
      (req.headers['Last-Event-ID'] as string) ??
      (req.query?.lastEventId as string) ??
      (req.query?.['last-event-id'] as string);

    if (rawLastId !== undefined && rawLastId !== '') {
      const parsedLastId = parseInt(rawLastId, 10);
      if (!Number.isNaN(parsedLastId)) {
        const missedEvents = this.orderEventsService.getEventsSince(id, parsedLastId);
        for (const evt of missedEvents) {
          this.writeSseEvent(res, evt);
        }
      }
    }

    const sub = this.orderEventsService.events$.subscribe((evt) => {
      if (evt.orderId === id) {
        this.writeSseEvent(res, evt);
      }
    });

    req.on('close', () => {
      sub.unsubscribe();
      res.end();
    });
  }

  @Get(':id')
  getOrderById(@Param('id') id: string) {
    return this.ordersService.findById(id);
  }

  @Patch(':id/status')
  updateOrderStatus(
    @Param('id') id: string,
    @Body() body: { status: string },
  ) {
    if (!body?.status) {
      throw new BadRequestException('Status is required');
    }
    return this.ordersService.updateStatus(id, body.status);
  }

  @Patch(':id')
  patchOrder(
    @Param('id') id: string,
    @Body() body: { status?: string },
  ) {
    if (body?.status) {
      return this.ordersService.updateStatus(id, body.status);
    }
    return this.ordersService.findById(id);
  }

  @Post(':id/status')
  postOrderStatus(
    @Param('id') id: string,
    @Body() body: { status: string },
  ) {
    if (!body?.status) {
      throw new BadRequestException('Status is required');
    }
    return this.ordersService.updateStatus(id, body.status);
  }

  private writeSseEvent(res: Response, evt: OrderStatusEvent) {
    const payload = {
      id: evt.id,
      orderId: evt.orderId,
      status: evt.status,
      timestamp: evt.timestamp,
      ...evt.data,
    };
    res.write(`id: ${evt.id}\n`);
    res.write(`event: order.status\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
    if (typeof (res as any).flush === 'function') {
      (res as any).flush();
    }
  }
}
