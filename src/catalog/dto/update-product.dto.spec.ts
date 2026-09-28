import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateProductDto } from './update-product.dto';

async function validateDto(payload: Record<string, unknown>) {
  const dto = plainToInstance(UpdateProductDto, payload);
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return { dto, errors };
}

describe('UpdateProductDto', () => {
  it('accepts an empty payload (no fields required)', async () => {
    const { errors } = await validateDto({});
    expect(errors).toHaveLength(0);
  });

  it('accepts a partial update of just the name', async () => {
    const { dto, errors } = await validateDto({ name: '  New Name  ' });
    expect(errors).toHaveLength(0);
    expect(dto.name).toBe('New Name');
  });

  it('rejects a body containing currentPrice (not a declared field)', async () => {
    const { errors } = await validateDto({ name: 'X', currentPrice: 9.99 });
    expect(
      errors.some((e) => e.constraints?.whitelistValidation !== undefined),
    ).toBe(true);
  });

  it('rejects an unknown unit', async () => {
    const { errors } = await validateDto({ unit: 'kg' });
    expect(errors.some((e) => e.property === 'unit')).toBe(true);
  });

  it('accepts a boolean isActive', async () => {
    const { dto, errors } = await validateDto({ isActive: false });
    expect(errors).toHaveLength(0);
    expect(dto.isActive).toBe(false);
  });
});
