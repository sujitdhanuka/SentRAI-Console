import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { buildDataSourceOptions, DbSettings } from './data-source-options';
import { SeedService } from './seed.service';
import { SchemaGuardService } from './schema-guard.service';
import { UserEntity } from './entities';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const db = config.get<DbSettings>('db')!;
        return buildDataSourceOptions(db);
      },
    }),
    TypeOrmModule.forFeature([UserEntity]),
  ],
  providers: [SchemaGuardService, SeedService],
})
export class DatabaseModule {}
