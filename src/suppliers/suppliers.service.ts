import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { formatDateMDY } from '../common/utils/date-format.util';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { PaginatedResult, SupplierResponse } from './suppliers.interface';

type RawSupplier = Prisma.SupplierGetPayload<Record<string, never>>;

function mapSupplier(supplier: RawSupplier): SupplierResponse {
  return {
    supplierId: supplier.supplierId,
    tenantId: supplier.tenantId,
    name: supplier.name,
    contactPerson: supplier.contactPerson,
    phone: supplier.phone,
    email: supplier.email,
    paymentTerms: supplier.paymentTerms,
    address: supplier.address,
    isActive: supplier.isActive,
    createdAt: formatDateMDY(supplier.createdAt, { includeTime: true }),
    updatedAt: formatDateMDY(supplier.updatedAt, { includeTime: true }),
  };
}

@Injectable()
export class SuppliersService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertTenantExists(tenantId: number): Promise<void> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { tenantId },
      select: { tenantId: true },
    });
    if (!tenant) {
      throw new NotFoundException(`Tenant ${tenantId} not found`);
    }
  }

  async create(
    tenantId: number,
    dto: CreateSupplierDto,
  ): Promise<SupplierResponse> {
    await this.assertTenantExists(tenantId);

    const supplier = await this.prisma.supplier.create({
      data: {
        tenantId,
        name: dto.name,
        contactPerson: dto.contactPerson,
        phone: dto.phone,
        email: dto.email,
        paymentTerms: dto.paymentTerms,
        address: dto.address,
      },
    });

    return mapSupplier(supplier);
  }

  /**
   * A supplier is only ever findable through its own tenant — the tenantId
   * in the path and the supplier's stored tenantId must both match, so one
   * tenant can never fetch another tenant's supplier by guessing an ID.
   */
  async findById(
    tenantId: number,
    supplierId: number,
  ): Promise<SupplierResponse> {
    const supplier = await this.prisma.supplier.findFirst({
      where: { supplierId, tenantId },
    });

    if (!supplier) {
      throw new NotFoundException(
        `Supplier ${supplierId} not found for tenant ${tenantId}`,
      );
    }

    return mapSupplier(supplier);
  }

  async findAll(
    tenantId: number,
    query: PaginationQueryDto,
  ): Promise<PaginatedResult<SupplierResponse>> {
    await this.assertTenantExists(tenantId);

    const page = query.page ?? 1;
    const perPage = query.per_page ?? 25;
    const skip = (page - 1) * perPage;

    const [data, total] = await Promise.all([
      this.prisma.supplier.findMany({
        where: { tenantId },
        skip,
        take: perPage,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.supplier.count({ where: { tenantId } }),
    ]);

    return {
      data: data.map(mapSupplier),
      meta: {
        total,
        page,
        per_page: perPage,
        total_pages: Math.ceil(total / perPage),
      },
    };
  }
}
