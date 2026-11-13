import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { AccessTokenPayload, JwtService } from './jwt.service';
import { DenylistService } from './denylist.service';

export interface AuthenticatedRequest extends Request {
  user: AccessTokenPayload;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly denylistService: DenylistService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or invalid Authorization header');
    }

    const token = authHeader.slice('Bearer '.length).trim();
    if (!token) {
      throw new UnauthorizedException('Empty bearer token');
    }

    const payload = this.jwtService.verifyAccessToken(token, {
      algorithms: ['ES256'],
    });

    const revoked = await this.denylistService.isRevoked(payload.jti);
    if (revoked) {
      throw new UnauthorizedException('Access token has been revoked');
    }

    (req as AuthenticatedRequest).user = payload;
    return true;
  }
}
