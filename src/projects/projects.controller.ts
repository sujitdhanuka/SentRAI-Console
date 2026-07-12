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
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType } from '../common/interfaces/current-user.interface';
import { ProjectsService } from './projects.service';
import { CreateProjectDto, GithubImportDto, ProjectResponse, UpdateProjectDto } from './projects.dto';

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

  /**
   * Upload a codebase ZIP from the browser; it is extracted into the
   * project's private workspace on the server, which becomes the scan root.
   * This is the onboarding path for hosted deployments, where users cannot
   * reference paths on the server's filesystem.
   */
  @Post(':projectId/codebase')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 200 * 1024 * 1024 } }))
  uploadCodebase(
    @CurrentUser() user: CurrentUserType,
    @Param('projectId') projectId: string,
    @UploadedFile() file: { originalname?: string; size?: number; buffer?: Buffer },
  ) {
    return this.projects.uploadCodebase(user, projectId, file);
  }

  /**
   * Upload an entire folder (webkitdirectory): many files, each carrying its
   * relative path in the filename. Extracted into the project workspace.
   */
  @Post(':projectId/codebase/folder')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FilesInterceptor('files', 10000, { limits: { fileSize: 50 * 1024 * 1024 } }))
  uploadCodebaseFolder(
    @CurrentUser() user: CurrentUserType,
    @Param('projectId') projectId: string,
    @UploadedFiles() files: Array<{ originalname?: string; buffer?: Buffer }>,
    @Body('paths') paths?: string | string[],
  ) {
    return this.projects.uploadCodebaseFolder(user, projectId, files, paths);
  }

  /** Import a GitHub repository into the project workspace by zipball download. */
  @Post(':projectId/codebase/github')
  importGithub(
    @CurrentUser() user: CurrentUserType,
    @Param('projectId') projectId: string,
    @Body() dto: GithubImportDto,
  ) {
    return this.projects.importCodebaseFromGithub(user, projectId, dto);
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
