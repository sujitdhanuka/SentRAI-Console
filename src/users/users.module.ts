import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { OrganizationEntity, UserEntity } from '../database/entities';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [TypeOrmModule.forFeature([UserEntity, OrganizationEntity])],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
