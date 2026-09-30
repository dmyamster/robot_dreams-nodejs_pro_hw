import { DataSource, Repository } from 'typeorm';
import { Order } from '../../entities/order.entity';

export class OrderRepository {
  private readonly repo: Repository<Order>;

  constructor(private readonly dataSource: DataSource) {
    this.repo = dataSource.getRepository(Order);
  }

  async create(data: Partial<Order>): Promise<Order> {
    const order = this.repo.create(data);
    return await this.repo.save(order);
  }

  async findById(id: string): Promise<Order | null> {
    return await this.repo.findOne({
      where: { id },
      relations: { account: true, product: true },
    });
  }

  async findByAccountId(accountId: string): Promise<Order[]> {
    return await this.repo.find({
      where: { accountId },
      order: { createdAt: 'DESC' },
    });
  }

  async findPendingOrders(): Promise<Order[]> {
    return await this.repo.find({
      where: { status: 'PENDING' },
      order: { createdAt: 'ASC' },
    });
  }

  async getVolumeBySector(): Promise<
    Array<{ sector: string; total_orders: number; total_volume_cents: string }>
  > {
    const result = await this.repo
      .createQueryBuilder('order')
      .innerJoin('order.product', 'product')
      .select('product.sector', 'sector')
      .addSelect('COUNT(order.id)', 'total_orders')
      .addSelect('SUM(order.total_amount)', 'total_volume_cents')
      .where("order.status = :status", { status: 'FILLED' })
      .groupBy('product.sector')
      .orderBy('SUM(order.total_amount)', 'DESC')
      .getRawMany();

    return result.map((r) => ({
      sector: r.sector,
      total_orders: Number(r.total_orders),
      total_volume_cents: r.total_volume_cents,
    }));
  }
}
