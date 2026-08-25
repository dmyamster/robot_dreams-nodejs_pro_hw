import { Injectable } from '../decorators/injectable';
import { RequestContext } from '../context/request-context';

@Injectable()
export class UsersRepository {
  public findUser(id: string) {
    const requestId = RequestContext.getRequestId();
    return {
      id,
      repositoryRequestId: requestId,
    };
  }
}

@Injectable()
export class UsersService {
  public count = 0;

  constructor(private readonly usersRepository: UsersRepository) {}

  public getUser(id: string) {
    this.count++;
    const requestId = RequestContext.getRequestId();
    const repoResult = this.usersRepository.findUser(id);
    return {
      id,
      source: 'UsersService',
      count: this.count,
      serviceRequestId: requestId,
      repoResult,
    };
  }

  public createUser(dto: any) {
    this.count++;
    const requestId = RequestContext.getRequestId();
    return {
      user: dto,
      isDtoInstance: typeof dto === 'object' && dto !== null,
      count: this.count,
      serviceRequestId: requestId,
    };
  }
}
