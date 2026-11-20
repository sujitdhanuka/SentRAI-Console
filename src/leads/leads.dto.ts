import { IsEmail, IsIn, IsISO8601, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export const LEAD_STATUSES = ['NEW', 'CONFIRMED', 'CONTACTED', 'DONE', 'CANCELLED'] as const;
export const CONTACT_TOPICS = ['general', 'pricing', 'partnership', 'support', 'security'] as const;

/** Fields shared by both public forms. `website` is a honeypot: people never see it, bots fill it. */
class PublicLeadBase {
  @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @IsEmail() @MaxLength(255) email!: string;
  @IsOptional() @IsString() @MaxLength(160) company?: string;
  @IsOptional() @IsString() @MaxLength(200) website?: string;
}

export class ContactDto extends PublicLeadBase {
  @IsOptional() @IsIn(CONTACT_TOPICS as unknown as string[]) topic?: string;
  @IsString() @MinLength(10) @MaxLength(4000) message!: string;
}

export class BookDemoDto extends PublicLeadBase {
  @IsString() @MinLength(2) @MaxLength(160) declare company: string;
  @IsOptional() @IsString() @MaxLength(120) role?: string;
  @IsOptional() @IsString() @MaxLength(2000) message?: string;
  @IsISO8601() slot_start!: string;
  @IsOptional() @IsString() @MaxLength(64) timezone?: string;
}

export class LeadUpdateDto {
  @IsOptional() @IsIn(LEAD_STATUSES as unknown as string[]) status?: string;
  @IsOptional() @IsString() @MaxLength(2000) admin_notes?: string;
}
