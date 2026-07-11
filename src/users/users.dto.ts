import { IsOptional, IsString } from 'class-validator';

export class AddUserDto {
  @IsString()
  email!: string;

  @IsString()
  full_name!: string;

  @IsString()
  password!: string;

  @IsString()
  role!: string;

  @IsOptional()
  @IsString()
  organization_id?: string | null;
}

export class ResetPasswordDto {
  @IsString()
  new_password!: string;
}

export interface UserResponse {
  user_id: string;
  email: string;
  full_name: string;
  role: string;
  is_active: boolean;
  organization_id: string | null;
  organization_name: string | null;
}
