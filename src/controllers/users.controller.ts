import { Controller } from '../decorators/controller';
import { Get, Post } from '../decorators/methods';
import { Param, Query, Body } from '../decorators/params';
import { UsersService } from '../services/users.service';
import { CreateUserDto } from '../dto/create-user.dto';
import { NotFoundError } from '../errors/http-errors';

@Controller('users')
export class UsersController {
  constructor(public readonly usersService: UsersService) {}

  @Get(':id')
  public getUserById(@Param('id') id: string) {
    if (id === 'not-found') {
      throw new NotFoundError(`User with id ${id} not found`);
    }
    if (id === 'boom') {
      throw new Error('Internal boom error with secret credentials at /secret.ts:42');
    }
    return this.usersService.getUser(id);
  }

  @Get()
  public listUsers(@Query('limit') limit: string) {
    return { limit: limit ?? '10', items: [] };
  }

  @Post()
  public createUser(@Body() dto: CreateUserDto) {
    return this.usersService.createUser(dto);
  }
}
