import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Vertical } from '@prisma/client';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { formatDateMDY } from '../common/utils/date-format.util';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { TenantResponse } from './tenants.interface';

type RawTenant = Prisma.TenantGetPayload<Record<string, never>>;

function mapTenant(tenant: RawTenant): TenantResponse {
  return {
    tenantId: tenant.tenantId,
    name: tenant.name,
    vertical: tenant.vertical,
    currency: tenant.currency,
    batchExpiryTrackingEnabled: tenant.batchExpiryTrackingEnabled,
    isActive: tenant.isActive,
    createdAt: formatDateMDY(tenant.createdAt, { includeTime: true }),
    updatedAt: formatDateMDY(tenant.updatedAt, { includeTime: true }),
  };
}

@Injectable()
export class TenantsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Registers a new business as an isolated tenant. batchExpiryTrackingEnabled
   * is derived from the vertical (pharmacy needs it, others don't) rather than
   * left to the caller — it is a vertical-driven default, not a free choice.
   */
  async register(createTenantDto: CreateTenantDto): Promise<TenantResponse> {
    const vertical = createTenantDto.vertical ?? Vertical.pharmacy;

    const tenant = await this.prisma.tenant.create({
      data: {
        name: createTenantDto.name,
        vertical,
        currency: createTenantDto.currency ?? 'NPR',
        batchExpiryTrackingEnabled: vertical === Vertical.pharmacy,
      },
    });

    return mapTenant(tenant);
  }

  async findById(tenantId: number): Promise<TenantResponse> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { tenantId },
    });

    if (!tenant) {
      throw new NotFoundException(`Tenant ${tenantId} not found`);
    }

    return mapTenant(tenant);
  }

  async findAll(query: PaginationQueryDto): Promise<{
    data: TenantResponse[];
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
      this.prisma.tenant.findMany({
        skip,
        take: perPage,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.tenant.count(),
    ]);

    return {
      data: data.map(mapTenant),
      meta: {
        total,
        page,
        per_page: perPage,
        total_pages: Math.ceil(total / perPage),
      },
    };
  }
}
