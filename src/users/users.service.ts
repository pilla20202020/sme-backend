import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { Prisma } from '@prisma/client';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { PrismaService } from '../prisma/prisma.service';
import { formatDateMDY } from '../common/utils/date-format.util';
import { formatPhoneNumber } from '../common/utils/phone-format.util';
import { CreateUserDto } from './dto/create-user.dto';
import { InviteUserDto } from './dto/invite-user.dto';
import { InvitedUser, SafeUser } from './users.interface';

const SAFE_USER_SELECT = {
  userId: true,
  ssoUserId: true,
  tenantId: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  isActive: true,
  lastLoggedInAt: true,
  ipAddress: true,
  createdAt: true,
  updatedAt: true,
} as const;

type RawSafeUser = Prisma.UserGetPayload<{ select: typeof SAFE_USER_SELECT }>;

// SSO-provisioned users with a single-word name were historically stored
// with lastName '-' to satisfy the NOT NULL column; treat it as absent.
function mapSafeUser(user: RawSafeUser): SafeUser {
  return {
    userId: user.userId,
    ssoUserId: user.ssoUserId != null ? Number(user.ssoUserId) : null,
    tenantId: user.tenantId,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName === '-' ? '' : user.lastName,
    phone: formatPhoneNumber(user.phone),
    isActive: user.isActive,
    lastLoggedInAt: formatDateMDY(user.lastLoggedInAt, { includeTime: true }),
    createdAt: formatDateMDY(user.createdAt, { includeTime: true }),
    updatedAt: formatDateMDY(user.updatedAt, { includeTime: true }),
  };
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createUserDto: CreateUserDto): Promise<SafeUser> {
    try {
      const user = await this.prisma.user.create({
        data: createUserDto,
        select: SAFE_USER_SELECT,
      });
      return mapSafeUser(user);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'A user with that email or SSO ID already exists',
        );
      }
      throw err;
    }
  }

  async findAll(query: PaginationQueryDto): Promise<{
    data: SafeUser[];
    meta: {
      total: number;
      page: number;
      per_page: number;
      total_pages: number;
    };
  }> {
    const page = query.page ?? 1;
    const perPage = query.per_page ?? 25;
    const skip = (page - 1) * perPage;

    const [data, total] = await Promise.all([
      this.prisma.user.findMany({
        select: SAFE_USER_SELECT,
        skip,
        take: perPage,
      }),
      this.prisma.user.count(),
    ]);

    return {
      data: data.map(mapSafeUser),
      meta: {
        total,
        page,
        per_page: perPage,
        total_pages: Math.ceil(total / perPage),
      },
    };
  }

  /**
   * Invites a new staff member into a tenant with a specific, tenant-
   * assignable role (STORY-003) and an initial password they log in with
   * (STORY-005). No SSO account exists for this user — ssoUserId stays
   * null; email is the unique lookup key.
   */
  async inviteToTenant(
    tenantId: number,
    inviteUserDto: InviteUserDto,
  ): Promise<InvitedUser> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { tenantId },
      select: { tenantId: true },
    });
    if (!tenant) {
      throw new NotFoundException(`Tenant ${tenantId} not found`);
    }

    const role = await this.prisma.role.findFirst({
      where: { roleName: inviteUserDto.roleName },
    });
    if (!role) {
      throw new NotFoundException(
        `Role "${inviteUserDto.roleName}" is not configured`,
      );
    }

    const passwordHash = await bcrypt.hash(inviteUserDto.password, 12);

    try {
      const user = await this.prisma.user.create({
        data: {
          tenantId,
          email: inviteUserDto.email,
          firstName: inviteUserDto.firstName,
          lastName: inviteUserDto.lastName,
          phone: inviteUserDto.phone,
          passwordHash,
          isActive: true,
          roles: { create: { roleId: role.roleId } },
        },
        select: SAFE_USER_SELECT,
      });

      return { ...mapSafeUser(user), roleName: inviteUserDto.roleName };
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          `A user with email "${inviteUserDto.email}" already exists`,
        );
      }
      throw err;
    }
  }

  async findAllByTenant(
    tenantId: number,
    query: PaginationQueryDto,
  ): Promise<{
    data: SafeUser[];
    meta: {
      total: number;
      page: number;
      per_page: number;
      total_pages: number;
    };
  }> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { tenantId },
      select: { tenantId: true },
    });
    if (!tenant) {
      throw new NotFoundException(`Tenant ${tenantId} not found`);
    }

    const page = query.page ?? 1;
    const perPage = query.per_page ?? 25;
    const skip = (page - 1) * perPage;

    const [data, total] = await Promise.all([
      this.prisma.user.findMany({
        where: { tenantId },
        select: SAFE_USER_SELECT,
        skip,
        take: perPage,
      }),
      this.prisma.user.count({ where: { tenantId } }),
    ]);

    return {
      data: data.map(mapSafeUser),
      meta: {
        total,
        page,
        per_page: perPage,
        total_pages: Math.ceil(total / perPage),
      },
    };
  }
}
