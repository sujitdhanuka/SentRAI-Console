import { IsOptional, IsString } from 'class-validator';

export class CreateOrganizationDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description: string = '';
}

export interface OrganizationResponse {
  organization_id: string;
  name: string;
  description: string;
  created_at: Date;
}
