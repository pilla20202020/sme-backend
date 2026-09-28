import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { formatDateMDY } from '../common/utils/date-format.util';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { ListCustomersQueryDto } from './dto/list-customers-query.dto';
import { CustomerResponse, PaginatedResult } from './customers.interface';

type RawCustomer = Prisma.CustomerGetPayload<Record<string, never>>;

function mapCustomer(customer: RawCustomer): CustomerResponse {
  return {
    customerId: customer.customerId,
    tenantId: customer.tenantId,
    name: customer.name,
    phone: customer.phone,
    email: customer.email,
    address: customer.address,
    isActive: customer.isActive,
    createdAt: formatDateMDY(customer.createdAt, { includeTime: true }),
    updatedAt: formatDateMDY(customer.updatedAt, { includeTime: true }),
  };
}

@Injectable()
export class CustomersService {
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

  /**
   * No uniqueness constraint on phone/email/name by design — the same
   * customer may legitimately be entered twice by different cashiers before
   * anyone notices (PRD: dedup tooling is out of scope for MVP).
   */
  async create(
    tenantId: number,
    dto: CreateCustomerDto,
  ): Promise<CustomerResponse> {
    await this.assertTenantExists(tenantId);

    const customer = await this.prisma.customer.create({
      data: {
        tenantId,
        name: dto.name,
        phone: dto.phone,
        email: dto.email,
        address: dto.address,
      },
    });

    return mapCustomer(customer);
  }

  /**
   * `search` matches against name OR phone, case-insensitive `contains`. No
   * `search` param returns all customers for the tenant (paginated) — a list
   * endpoint with no results is a valid 200, never a 404 (PRD AC-2).
   */
  async findAll(
    tenantId: number,
    query: ListCustomersQueryDto,
  ): Promise<PaginatedResult<CustomerResponse>> {
    await this.assertTenantExists(tenantId);

    const page = query.page ?? 1;
    const perPage = query.per_page ?? 25;
    const skip = (page - 1) * perPage;

    const where: Prisma.CustomerWhereInput = {
      tenantId,
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { phone: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        skip,
        take: perPage,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.customer.count({ where }),
    ]);

    return {
      data: data.map(mapCustomer),
      meta: {
        total,
        page,
        per_page: perPage,
        total_pages: Math.ceil(total / perPage),
      },
    };
  }
}
