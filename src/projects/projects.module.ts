import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AIModelEntity, OrganizationEntity, ProjectEntity } from '../database/entities';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  imports: [TypeOrmModule.forFeature([ProjectEntity, AIModelEntity, OrganizationEntity])],
  controllers: [ProjectsController],
  providers: [ProjectsService],
})
export class ProjectsModule {}
