import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ProjectEntity } from '../database/entities';
import { CiTokenService } from './ci-token.service';

/**
 * Authenticates a CI service token and binds the request to its project.
 * Separate from the interactive JwtAuthGuard: a stolen developer JWT cannot
 * drive the pipeline gate, and a leaked CI token cannot drive the console.
 */
@Injectable()
export class CiServiceTokenGuard implements CanActivate {
  constructor(
    private readonly tokens: CiTokenService,
    @InjectRepository(ProjectEntity) private readonly projects: Repository<ProjectEntity>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const header: string = req.headers?.authorization ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('CI service token required (Authorization: Bearer <token>)');
    }

    let projectId: string;
    let label: string | undefined;
    try {
      const claims = this.tokens.verify(token);
      projectId = claims.project_id;
      label = claims.label;
    } catch {
      throw new UnauthorizedException('Invalid or expired CI service token');
    }

    const project = await this.projects.findOne({ where: { id: projectId } });
    if (!project) throw new UnauthorizedException('CI token references a project that no longer exists');

    req.ciContext = { projectId, actor: `ci:${label ?? projectId}` };
    return true;
  }
}
