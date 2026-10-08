import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Inject, forwardRef } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrderEventsService } from './order-events.service';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class OrdersGateway implements OnGatewayInit {
  @WebSocketServer()
  server!: Server;

  constructor(
    @Inject(forwardRef(() => OrdersService))
    private readonly ordersService: OrdersService,
    private readonly orderEventsService: OrderEventsService,
  ) {}

  afterInit() {
    this.orderEventsService.events$.subscribe((event) => {
      if (this.server) {
        this.server.to(`orders:${event.orderId}`).emit('order.status', {
          id: event.id,
          orderId: event.orderId,
          status: event.status,
          timestamp: event.timestamp,
          ...event.data,
        });
      }
    });
  }

  @SubscribeMessage('join')
  async handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: any,
  ) {
    const orderId =
      typeof payload === 'string'
        ? payload
        : payload?.orderId || payload?.id;

    if (!orderId) {
      return { success: false, error: 'Order ID is required' };
    }

    // Authenticate account
    const accountId =
      payload?.accountId ||
      payload?.userId ||
      client.handshake?.auth?.accountId ||
      client.handshake?.auth?.userId ||
      client.handshake?.headers?.['x-account-id'] ||
      client.handshake?.query?.accountId;

    if (!accountId) {
      return { success: false, error: 'Unauthorized: missing account identification' };
    }

    // Validate ownership
    let order: any;
    try {
      order = this.ordersService.findById(orderId);
    } catch {
      return { success: false, error: 'Order not found' };
    }

    if (order.account_id !== accountId) {
      return { success: false, error: 'Forbidden: order does not belong to user' };
    }

    const room = `orders:${orderId}`;
    await client.join(room);

    return { success: true, room, orderId };
  }
}
