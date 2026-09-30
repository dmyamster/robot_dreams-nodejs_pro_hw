import { DataSource, Repository } from 'typeorm';
import { Account } from '../../entities/account.entity';

export class AccountRepository {
  private readonly repo: Repository<Account>;

  constructor(private readonly dataSource: DataSource) {
    this.repo = dataSource.getRepository(Account);
  }

  async create(data: Partial<Account>): Promise<Account> {
    const account = this.repo.create(data);
    return await this.repo.save(account);
  }

  async findById(id: string): Promise<Account | null> {
    return await this.repo.findOne({ where: { id }, relations: { user: true } });
  }

  async findByAccountNumber(accountNumber: string): Promise<Account | null> {
    return await this.repo.findOne({ where: { accountNumber } });
  }
}
