import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

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
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  full_name!: string;

  @IsString()
  @MinLength(8, { message: 'password must be at least 8 characters' })
  @MaxLength(200)
  password!: string;

  // NOTE: self-registration NEVER accepts a role. Everyone who signs up
  // publicly becomes a VIEWER; elevated roles are granted only by an admin
  // through POST /api/v1/users. A `role` sent here is silently ignored
  // (stripped by the global whitelisting ValidationPipe).
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
