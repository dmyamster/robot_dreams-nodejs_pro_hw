import * as amqp from "amqplib";

export function getBrokerUrl(): string {
  return process.env.BROKER_URL || "amqp://app:app@127.0.0.1:5672";
}

export async function createConnection(
  url?: string,
): Promise<amqp.ChannelModel> {
  const brokerUrl = url || getBrokerUrl();
  return amqp.connect(brokerUrl);
}
