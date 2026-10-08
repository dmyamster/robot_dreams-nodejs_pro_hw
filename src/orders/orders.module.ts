import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrderEventsService } from './order-events.service';
import { OrdersGateway } from './orders.gateway';
import { InstrumentsModule } from '../instruments/instruments.module';

@Module({
  imports: [InstrumentsModule],
  controllers: [OrdersController],
  providers: [OrdersService, OrderEventsService, OrdersGateway],
  exports: [OrdersService, OrderEventsService, OrdersGateway],
})
export class OrdersModule {}
