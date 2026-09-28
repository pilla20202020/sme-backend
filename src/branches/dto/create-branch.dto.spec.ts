import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateBranchDto } from './create-branch.dto';

async function validateDto(payload: Record<string, unknown>) {
  const dto = plainToInstance(CreateBranchDto, payload);
  const errors = await validate(dto);
  return { dto, errors };
}

describe('CreateBranchDto', () => {
  it('rejects a whitespace-only name after trimming', async () => {
    const { errors } = await validateDto({ name: '  ' });

    expect(errors.some((e) => e.property === 'name')).toBe(true);
  });

  it('trims leading/trailing whitespace from a valid name', async () => {
    const { dto, errors } = await validateDto({ name: '  Downtown Branch  ' });

    expect(errors).toHaveLength(0);
    expect(dto.name).toBe('Downtown Branch');
  });

  it('trims a provided address', async () => {
    const { dto, errors } = await validateDto({
      name: 'Downtown Branch',
      address: '  123 Main St  ',
    });

    expect(errors).toHaveLength(0);
    expect(dto.address).toBe('123 Main St');
  });
});
