import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UserEntity } from '../database/entities';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { JwtStrategy } from './jwt.strategy';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserEntity]),
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<{ secret: string }>('jwt')!.secret,
        signOptions: { algorithm: 'HS256' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, TokenService, JwtStrategy],
  exports: [TokenService],
})
export class AuthModule {}
