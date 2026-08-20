import 'reflect-metadata';
import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  Injectable,
  Dispatcher,
  CreateUserDto,
} from './index';

@Injectable()
class UsersService {
  private users = [
    { id: '1', email: 'alice@example.com', name: 'Alice' },
    { id: '2', email: 'bob@example.com', name: 'Bob' },
  ];

  public findAll(limit?: string) {
    const lim = limit ? parseInt(limit, 10) : this.users.length;
    return this.users.slice(0, lim);
  }

  public findById(id: string) {
    return this.users.find(u => u.id === id) || { message: 'User not found' };
  }

  public create(dto: CreateUserDto) {
    const newUser = { id: String(this.users.length + 1), ...dto };
    this.users.push(newUser);
    return newUser;
  }
}

@Controller('users')
class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get(':id')
  public getUser(@Param('id') id: string) {
    return this.usersService.findById(id);
  }

  @Get()
  public listUsers(@Query('limit') limit?: string) {
    return this.usersService.findAll(limit);
  }

  @Post()
  public createUser(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }
}

const PORT = Number(process.env.PORT) || 3000;

const dispatcher = new Dispatcher({
  controllers: [UsersController],
});

dispatcher.listen(PORT, () => {
  console.log(`🚀 Mini-Nest server is running on http://localhost:${PORT}`);
  console.log(`Try:`);
  console.log(`  GET  http://localhost:${PORT}/users`);
  console.log(`  GET  http://localhost:${PORT}/users/1`);
  console.log(`  GET  http://localhost:${PORT}/users?limit=1`);
  console.log(`  POST http://localhost:${PORT}/users  (JSON: {"email":"john@example.com","name":"John"})`);
});
