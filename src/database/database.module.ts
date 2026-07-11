import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { buildDataSourceOptions, DbSettings } from './data-source-options';
import { SeedService } from './seed.service';
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
  providers: [SeedService],
})
export class DatabaseModule {}
