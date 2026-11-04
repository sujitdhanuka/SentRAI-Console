import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AIModelEntity, DeploymentGateEventEntity, ProjectEntity } from '../database/entities';
import { NotifierService } from '../common/notifier.service';
import { DiscoveryModule } from '../discovery/discovery.module';
import { IncidentsModule } from '../incidents/incidents.module';
import { CiController } from './ci.controller';
import { CiEvaluationService } from './ci.service';
import { CiTokenService } from './ci-token.service';
import { CiServiceTokenGuard } from './ci-token.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([AIModelEntity, DeploymentGateEventEntity, ProjectEntity]),
    DiscoveryModule, // provides the shared TreeSitterService
    IncidentsModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<{ secret: string }>('jwt')!.secret,
        signOptions: { algorithm: 'HS256' },
      }),
    }),
  ],
  controllers: [CiController],
  providers: [CiEvaluationService, CiTokenService, CiServiceTokenGuard, NotifierService],
})
export class CiModule {}
