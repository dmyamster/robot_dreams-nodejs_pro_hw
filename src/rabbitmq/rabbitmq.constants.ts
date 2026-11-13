export const RABBITMQ_EXCHANGE = "shop.events";
export const RABBITMQ_DLX_EXCHANGE = "shop.dlx";
export const RABBITMQ_QUEUE_ORDER_PLACED = "orders.order-placed";
export const RABBITMQ_QUEUE_ORDER_PLACED_DLQ = "orders.order-placed.dlq";
export const RABBITMQ_ROUTING_KEY_ORDER_PLACED = "order.placed";
export const RABBITMQ_ROUTING_KEY_ORDER_PLACED_DLQ = "order.placed.dlq";
export const DEFAULT_PREFETCH = 10;
