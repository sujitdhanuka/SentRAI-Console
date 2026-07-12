import { IsIn, IsOptional, IsString } from 'class-validator';

export class CreateOrganizationDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description: string = '';
}

export class UpdatePlanDto {
  @IsIn(['COMMUNITY', 'GROWTH', 'ENTERPRISE'])
  plan!: 'COMMUNITY' | 'GROWTH' | 'ENTERPRISE';
}

export interface OrganizationResponse {
  organization_id: string;
  name: string;
  description: string;
  plan: string;
  created_at: Date;
}
