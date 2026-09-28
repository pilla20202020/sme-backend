import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateTenantDto } from './create-tenant.dto';

async function validateDto(payload: Record<string, unknown>) {
  const dto = plainToInstance(CreateTenantDto, payload);
  const errors = await validate(dto);
  return { dto, errors };
}

describe('CreateTenantDto', () => {
  it('rejects a whitespace-only name after trimming', async () => {
    const { errors } = await validateDto({ name: '   ' });

    expect(errors.some((e) => e.property === 'name')).toBe(true);
  });

  it('trims leading/trailing whitespace from a valid name', async () => {
    const { dto, errors } = await validateDto({ name: '  Sample Pharmacy  ' });

    expect(errors).toHaveLength(0);
    expect(dto.name).toBe('Sample Pharmacy');
  });

  it('accepts a valid 3-letter uppercase currency code', async () => {
    const { errors } = await validateDto({ name: 'Valid Co', currency: 'NPR' });

    expect(errors.some((e) => e.property === 'currency')).toBe(false);
  });

  it('rejects a lowercase currency code', async () => {
    const { errors } = await validateDto({ name: 'Valid Co', currency: 'npr' });

    expect(errors.some((e) => e.property === 'currency')).toBe(true);
  });

  it('rejects a non-alphabetic currency code', async () => {
    const { errors } = await validateDto({ name: 'Valid Co', currency: '123' });

    expect(errors.some((e) => e.property === 'currency')).toBe(true);
  });
});
