import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { formatDateMDY } from '../common/utils/date-format.util';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBranchDto } from './dto/create-branch.dto';
import { BranchResponse } from './branches.interface';

type RawBranch = Prisma.BranchGetPayload<Record<string, never>>;

function mapBranch(branch: RawBranch): BranchResponse {
  return {
    branchId: branch.branchId,
    tenantId: branch.tenantId,
    name: branch.name,
    address: branch.address,
    isActive: branch.isActive,
    createdAt: formatDateMDY(branch.createdAt, { includeTime: true }),
    updatedAt: formatDateMDY(branch.updatedAt, { includeTime: true }),
  };
}

@Injectable()
export class BranchesService {
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
    createBranchDto: CreateBranchDto,
  ): Promise<BranchResponse> {
    await this.assertTenantExists(tenantId);

    const branch = await this.prisma.branch.create({
      data: {
        tenantId,
        name: createBranchDto.name,
        address: createBranchDto.address,
      },
    });

    return mapBranch(branch);
  }

  /**
   * A branch is only ever findable through its own tenant — the tenantId in
   * the path and the branch's stored tenantId must both match, so one
   * tenant can never fetch another tenant's branch by guessing an ID.
   */
  async findById(tenantId: number, branchId: number): Promise<BranchResponse> {
    const branch = await this.prisma.branch.findFirst({
      where: { branchId, tenantId },
    });

    if (!branch) {
      throw new NotFoundException(
        `Branch ${branchId} not found for tenant ${tenantId}`,
      );
    }

    return mapBranch(branch);
  }

  async findAll(
    tenantId: number,
    query: PaginationQueryDto,
  ): Promise<{
    data: BranchResponse[];
    meta: {
      total: number;
      page: number;
      per_page: number;
      total_pages: number;
    };
  }> {
    await this.assertTenantExists(tenantId);

    const page = query.page ?? 1;
    const perPage = query.per_page ?? 25;
    const skip = (page - 1) * perPage;

    const [data, total] = await Promise.all([
      this.prisma.branch.findMany({
        where: { tenantId },
        skip,
        take: perPage,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.branch.count({ where: { tenantId } }),
    ]);

    return {
      data: data.map(mapBranch),
      meta: {
        total,
        page,
        per_page: perPage,
        total_pages: Math.ceil(total / perPage),
      },
    };
  }
}
