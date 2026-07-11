import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType } from '../common/interfaces/current-user.interface';
import { ProjectsService } from './projects.service';
import { CreateProjectDto, ProjectResponse, UpdateProjectDto } from './projects.dto';

@ApiTags('Projects')
@ApiBearerAuth()
@Controller('api/v1/projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: CurrentUserType, @Body() dto: CreateProjectDto): Promise<ProjectResponse> {
    return this.projects.create(user, dto);
  }

  @Get()
  list(@CurrentUser() user: CurrentUserType): Promise<ProjectResponse[]> {
    return this.projects.list(user);
  }

  @Get(':projectId')
  get(@Param('projectId') projectId: string): Promise<ProjectResponse> {
    return this.projects.get(projectId);
  }

  @Patch(':projectId')
  update(
    @CurrentUser() user: CurrentUserType,
    @Param('projectId') projectId: string,
    @Body() dto: UpdateProjectDto,
  ): Promise<ProjectResponse> {
    return this.projects.update(user, projectId, dto);
  }

  @Delete(':projectId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: CurrentUserType,
    @Param('projectId') projectId: string,
    @Query('cascade') cascade?: string,
  ): Promise<void> {
    return this.projects.remove(user, projectId, cascade === 'true' || cascade === '1');
  }
}
