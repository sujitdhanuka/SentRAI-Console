import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AIModelEntity, BcpDrillEntity, OrganizationEntity, ProjectEntity } from '../database/entities';
import { DiscoveryModule } from '../discovery/discovery.module';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ProjectEntity, AIModelEntity, OrganizationEntity, BcpDrillEntity]),
    DiscoveryModule, // provides the shared TreeSitterService for scan-on-upload
  ],
  controllers: [ProjectsController],
  providers: [ProjectsService],
})
export class ProjectsModule {}
