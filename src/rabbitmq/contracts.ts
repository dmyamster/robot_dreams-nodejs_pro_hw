export interface OrderPlacedEventData {
  orderId: string;
  accountId: string;
  productId: string;
  symbol: string;
  quantity: number;
  price: string;
  totalAmount: string;
}

export interface OrderPlacedEvent {
  eventId: string;
  type: "order.placed";
  occurredAt: string;
  data: OrderPlacedEventData;
  isPoison?: boolean;
}
