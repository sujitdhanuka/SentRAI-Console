import { IsBoolean, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { Role } from '../common/enums';

export class AddUserDto {
  @IsString()
  email!: string;

  @IsString()
  full_name!: string;

  @IsString()
  @MinLength(8, { message: 'password must be at least 8 characters' })
  password!: string;

  @IsEnum(Role)
  role!: Role;

  @IsOptional()
  @IsString()
  organization_id?: string | null;
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  full_name?: string;

  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class ResetPasswordDto {
  @IsString()
  @MinLength(8, { message: 'password must be at least 8 characters' })
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
