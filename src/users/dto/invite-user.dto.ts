import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

// Platform admin/support is never invitable by a tenant owner — that role is
// assigned only through internal SSO provisioning (see AuthService), not
// this endpoint. Keep in sync with prisma/seed.ts's tenant-facing roles.
export const TENANT_ASSIGNABLE_ROLES = [
  'owner',
  'manager',
  'cashier',
  'inventory_staff',
  'accountant',
] as const;

export type TenantAssignableRole = (typeof TENANT_ASSIGNABLE_ROLES)[number];

export class InviteUserDto {
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : (value as string),
  )
  @IsString()
  @MaxLength(100)
  firstName!: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : (value as string),
  )
  @IsString()
  @MaxLength(100)
  lastName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @IsIn(TENANT_ASSIGNABLE_ROLES)
  roleName!: TenantAssignableRole;

  // No email-based invite-token flow exists yet (no email infrastructure is
  // wired up — send_email is still a logging stub). For this MVP milestone
  // the inviter sets an initial password directly and communicates it to
  // the invitee out of band; a real invite-link/set-password flow is a
  // follow-up once email sending is real.
  @IsString()
  @MinLength(8)
  @MaxLength(255)
  password!: string;
}
