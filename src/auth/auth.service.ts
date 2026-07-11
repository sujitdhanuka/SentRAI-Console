import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { UserEntity } from '../database/entities';
import { hashPassword, verifyPassword } from '../common/password';
import { CurrentUser } from '../common/interfaces/current-user.interface';
import { TokenService } from './token.service';
import { AuthUserResponse, RegisterDto, TokenResponse } from './dto/auth.dto';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    private readonly tokens: TokenService,
  ) {}

  private tokenResponse(user: UserEntity): TokenResponse {
    const tenantId = user.tenantId ?? null;
    return {
      access_token: this.tokens.createAccessToken(user.email, user.role, tenantId, user.fullName),
      refresh_token: this.tokens.createRefreshToken(user.email),
      token_type: 'bearer',
      role: user.role,
    };
  }

  async login(username: string, password: string): Promise<TokenResponse> {
    const user = await this.users.findOne({ where: { email: username } });
    if (!user || !verifyPassword(password, user.hashedPassword)) {
      throw new UnauthorizedException('Incorrect email or password');
    }
    if (!user.isActive) {
      throw new ForbiddenException('Account is deactivated');
    }
    return this.tokenResponse(user);
  }

  async refresh(refreshToken: string): Promise<TokenResponse> {
    let claims: Record<string, any>;
    try {
      claims = this.tokens.decode(refreshToken);
    } catch (e) {
      throw new UnauthorizedException(`Invalid or expired token: ${String(e)}`);
    }
    if (claims.type !== 'refresh') {
      throw new UnauthorizedException('Not a refresh token');
    }
    const user = await this.users.findOne({ where: { email: claims.sub } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('User not found or inactive');
    }
    return this.tokenResponse(user);
  }

  async register(dto: RegisterDto): Promise<AuthUserResponse> {
    const existing = await this.users.findOne({ where: { email: dto.email } });
    if (existing) {
      throw new ConflictException(`User '${dto.email}' already exists`);
    }
    const now = new Date();
    const user = await this.users.save(
      this.users.create({
        id: uuidv4(),
        email: dto.email,
        fullName: dto.full_name,
        hashedPassword: hashPassword(dto.password),
        role: dto.role ?? 'VIEWER',
        tenantId: null,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      }),
    );
    return {
      user_id: user.id,
      email: user.email,
      full_name: user.fullName,
      role: user.role,
      tenant_id: null,
    };
  }

  me(user: CurrentUser): AuthUserResponse {
    return {
      user_id: user.userId,
      email: user.email,
      full_name: user.fullName,
      role: user.role,
      tenant_id: user.tenantId ?? null,
    };
  }
}
