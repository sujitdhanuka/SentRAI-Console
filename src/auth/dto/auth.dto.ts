import { IsOptional, IsString, MinLength } from 'class-validator';

/** OAuth2 password form (application/x-www-form-urlencoded): username + password. */
export class LoginDto {
  @IsString()
  username!: string;

  @IsString()
  password!: string;
}

export class RefreshDto {
  @IsString()
  refresh_token!: string;
}

export class RegisterDto {
  @IsString()
  email!: string;

  @IsString()
  full_name!: string;

  @IsString()
  @MinLength(1)
  password!: string;

  @IsOptional()
  @IsString()
  role: string = 'VIEWER';
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  role: string;
}

export interface AuthUserResponse {
  user_id: string;
  email: string;
  full_name: string;
  role: string;
  tenant_id: string | null;
}
