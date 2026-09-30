import { DataSource, Repository } from 'typeorm';
import { Product } from '../../entities/product.entity';

export class ProductRepository {
  private readonly repo: Repository<Product>;

  constructor(private readonly dataSource: DataSource) {
    this.repo = dataSource.getRepository(Product);
  }

  async create(data: Partial<Product>): Promise<Product> {
    const product = this.repo.create(data);
    return await this.repo.save(product);
  }

  async findById(id: string): Promise<Product | null> {
    return await this.repo.findOne({ where: { id } });
  }

  async findBySymbol(symbol: string): Promise<Product | null> {
    return await this.repo.findOne({ where: { symbol } });
  }

  async decrementStock(id: string, quantity: number): Promise<{ id: string; stock: number; currentPrice: string }> {
    const result = await this.dataSource.query(
      `UPDATE "products" 
       SET "stock" = "stock" - $1, "updated_at" = NOW() 
       WHERE "id" = $2 AND "stock" >= $1 
       RETURNING "id", "stock", "current_price"`,
      [quantity, id],
    );

    const rows = Array.isArray(result[0]) ? result[0] : result;
    if (!rows || rows.length === 0) {
      throw new Error(`Insufficient stock for product ${id}`);
    }
    return {
      id: rows[0].id,
      stock: Number(rows[0].stock),
      currentPrice: rows[0].current_price,
    };
  }

  async upsertBySymbol(data: Partial<Product>): Promise<Product> {
    await this.dataSource.query(
      `INSERT INTO "products" ("symbol", "name", "description", "sector", "current_price", "trading_status", "stock", "created_at", "updated_at")
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
       ON CONFLICT ("symbol") DO UPDATE
       SET "current_price" = EXCLUDED."current_price",
           "updated_at" = NOW()`,
      [
        data.symbol,
        data.name || 'Default Name',
        data.description || '',
        data.sector || 'Technology',
        data.currentPrice || '10000',
        data.tradingStatus || 'ACTIVE',
        data.stock || 0,
      ],
    );
    return (await this.findBySymbol(data.symbol!))!;
  }

  async countBySector(): Promise<Array<{ sector: string; count: number }>> {
    const rows = await this.dataSource.query(
      `SELECT "sector", COUNT(*)::int as count FROM "products" GROUP BY "sector" ORDER BY count DESC`,
    );
    return rows;
  }
}
