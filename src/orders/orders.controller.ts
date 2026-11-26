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
  UseGuards,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { OrdersService, CreateOrderDto } from './orders.service';
import { OrderEventsService, OrderStatusEvent } from './order-events.service';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { createLayerLogger } from '../observability/logger';

@Controller('orders')
@UseGuards(JwtAuthGuard)
export class OrdersController {
  private readonly logger = createLayerLogger('orders.controller');

  constructor(
    private readonly ordersService: OrdersService,
    private readonly orderEventsService: OrderEventsService,
  ) {}

  @Post()
  async createOrder(
    @Headers('idempotency-key') idempotencyKey: string,
    @Body() createOrderDto: CreateOrderDto,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ) {
    this.logger.info({ symbol: createOrderDto.symbol }, 'controller createOrder');
    const result = await this.ordersService.create(
      idempotencyKey,
      createOrderDto,
      req.user.sub,
    );

    if (result.isReplay) {
      res.setHeader('Idempotency-Replay', 'true');
    }

    return res.status(HttpStatus.CREATED).json(result.order);
  }

  @Get()
  getOrders(
    @Req() req: AuthenticatedRequest,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const parsedLimit = limit ? parseInt(limit, 10) : 20;
    return this.ordersService.findAll(parsedLimit, cursor, req.user);
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
  getOrderById(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
    @Headers('x-demo-delay-ms') demoDelayMs?: string,
  ) {
    this.logger.info({ orderId: id }, 'controller getOrderById');
    const parsedDelay = demoDelayMs ? parseInt(demoDelayMs, 10) : 0;
    const boundedDelay =
      Number.isFinite(parsedDelay) && parsedDelay > 0
        ? Math.min(parsedDelay, 5000)
        : 0;
    return this.ordersService.findById(id, req.user, boundedDelay);
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
