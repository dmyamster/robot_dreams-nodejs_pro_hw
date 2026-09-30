import 'reflect-metadata';
import AppDataSource from './data-source';
import { Order } from './entities/order.entity';

export async function runReport(): Promise<void> {
  const dataSource = AppDataSource.isInitialized
    ? AppDataSource
    : await AppDataSource.initialize();

  try {
    console.log('\n📊 Generating Market Sector Trading Volume Report (QueryBuilder)...\n');

    // Aggregate + GROUP BY + JOIN across orders and products
    // This report cannot be expressed via Repository.find()
    const reportData = await dataSource
      .getRepository(Order)
      .createQueryBuilder('order')
      .innerJoin('order.product', 'product')
      .select('product.sector', 'sector')
      .addSelect('COUNT(order.id)', 'total_orders')
      .addSelect('SUM(order.quantity)', 'total_shares_traded')
      .addSelect('SUM(order.total_amount)', 'total_volume_cents')
      .addSelect('SUM(order.fee)', 'total_fees_cents')
      .addSelect('ROUND(AVG(COALESCE(order.execution_price, 0)), 2)', 'avg_execution_price_cents')
      .where("order.status = :status", { status: 'FILLED' })
      .groupBy('product.sector')
      .orderBy('SUM(order.total_amount)', 'DESC')
      .getRawMany();

    console.log('=============================================================================================');
    console.log('              FINANCIAL REPORT: FILLED TRADING VOLUME BY MARKET SECTOR                       ');
    console.log('=============================================================================================');

    const formatted = reportData.map((row) => ({
      'Сектор ринку': row.sector,
      'Угод': Number(row.total_orders),
      'Акцій проторговано': Number(row.total_shares_traded),
      'Обіг ($)': (Number(row.total_volume_cents) / 100).toFixed(2),
      'Комісії ($)': (Number(row.total_fees_cents) / 100).toFixed(2),
      'Сер. ціна ($)': (Number(row.avg_execution_price_cents) / 100).toFixed(2),
    }));

    console.table(formatted);
    console.log(`\nВсього секторів у звіті: ${reportData.length}`);
  } finally {
    await dataSource.destroy();
  }
}

if (require.main === module) {
  runReport()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌ Report failed:', err);
      process.exit(1);
    });
}
