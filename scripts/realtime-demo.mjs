import { io } from 'socket.io-client';

const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

const sameRoom = process.argv.includes('--same-room');
const orderA = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const orderB = 'c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33';

const roomA = orderA;
const roomB = sameRoom ? orderA : orderB;
const expectedB = sameRoom ? 1 : 0;

const accountId = 'b1febc99-9c0b-4ef8-bb6d-6bb9bd380a22';

async function main() {
  let aReceived = 0;
  let bReceived = 0;

  const socketA = io(BASE_URL, {
    auth: { accountId },
    transports: ['websocket', 'polling'],
  });

  const socketB = io(BASE_URL, {
    auth: { accountId },
    transports: ['websocket', 'polling'],
  });

  try {
    await Promise.all([
      new Promise((resolve, reject) => {
        socketA.once('connect', resolve);
        socketA.once('connect_error', reject);
      }),
      new Promise((resolve, reject) => {
        socketB.once('connect', resolve);
        socketB.once('connect_error', reject);
      }),
    ]);

    await Promise.all([
      new Promise((resolve, reject) => {
        socketA.emit('join', { orderId: roomA, accountId }, (ack) => {
          if (ack && ack.success === false) {
            reject(new Error(ack.error || 'Join A failed'));
          } else {
            resolve(ack);
          }
        });
      }),
      new Promise((resolve, reject) => {
        socketB.emit('join', { orderId: roomB, accountId }, (ack) => {
          if (ack && ack.success === false) {
            reject(new Error(ack.error || 'Join B failed'));
          } else {
            resolve(ack);
          }
        });
      }),
    ]);

    socketA.on('order.status', (data) => {
      if (data?.orderId === orderA) {
        aReceived++;
      }
    });

    socketB.on('order.status', (data) => {
      if (data?.orderId === orderA) {
        bReceived++;
      }
    });

    // Small delay to ensure subscriptions are established
    await new Promise((resolve) => setTimeout(resolve, 150));

    // HTTP PATCH status of order A
    const res = await fetch(`${BASE_URL}/orders/${orderA}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'CANCELLED' }),
    });

    if (!res.ok) {
      throw new Error(`Failed to update order status: ${res.status} ${res.statusText}`);
    }

    // Wait for event propagation
    await new Promise((resolve) => setTimeout(resolve, 500));
  } finally {
    socketA.disconnect();
    socketB.disconnect();
  }

  console.log(`A_RECEIVED=${aReceived}`);
  console.log(`B_RECEIVED=${bReceived}`);

  const success = aReceived === 1 && bReceived === expectedB;
  process.exit(success ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
