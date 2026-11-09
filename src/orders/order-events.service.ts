import { Injectable } from '@nestjs/common';
import { Subject, Observable } from 'rxjs';

export interface OrderStatusEvent {
  id: number;
  orderId: string;
  status: string;
  timestamp: string;
  data?: Record<string, any>;
}

@Injectable()
export class OrderEventsService {
  private readonly eventsSubject = new Subject<OrderStatusEvent>();
  private readonly eventsBuffer: OrderStatusEvent[] = [];
  private readonly maxBufferSize = 1000;
  private readonly orderSequenceMap = new Map<string, number>();

  get events$(): Observable<OrderStatusEvent> {
    return this.eventsSubject.asObservable();
  }

  emitOrderStatus(
    orderId: string,
    status: string,
    extraData?: Record<string, any>,
  ): OrderStatusEvent {
    const seq = (this.orderSequenceMap.get(orderId) || 0) + 1;
    this.orderSequenceMap.set(orderId, seq);

    const event: OrderStatusEvent = {
      id: seq,
      orderId,
      status,
      timestamp: new Date().toISOString(),
      ...(extraData ? { data: extraData } : {}),
    };

    this.eventsBuffer.push(event);
    if (this.eventsBuffer.length > this.maxBufferSize) {
      this.eventsBuffer.shift();
    }

    this.eventsSubject.next(event);
    return event;
  }

  getEventsSince(orderId: string, lastEventId: number): OrderStatusEvent[] {
    return this.eventsBuffer.filter(
      (e) => e.orderId === orderId && e.id > lastEventId,
    );
  }

  getAllEventsForOrder(orderId: string): OrderStatusEvent[] {
    return this.eventsBuffer.filter((e) => e.orderId === orderId);
  }
}
