import { Global, Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { DenylistService } from './denylist.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { JwtService } from './jwt.service';
import { RolesGuard } from './roles.guard';

@Global()
@Module({
  controllers: [AuthController],
  providers: [
    JwtService,
    DenylistService,
    AuthService,
    JwtAuthGuard,
    RolesGuard,
  ],
  exports: [
    JwtService,
    DenylistService,
    AuthService,
    JwtAuthGuard,
    RolesGuard,
  ],
})
export class AuthModule {}
