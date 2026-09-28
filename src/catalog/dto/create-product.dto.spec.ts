import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateProductDto } from './create-product.dto';

async function validateDto(payload: Record<string, unknown>) {
  const dto = plainToInstance(CreateProductDto, payload);
  const errors = await validate(dto);
  return { dto, errors };
}

describe('CreateProductDto', () => {
  const VALID = {
    name: 'Paracetamol 500mg',
    unit: 'tablet',
    currentPrice: 1.5,
  };

  it('accepts a minimal valid payload', async () => {
    const { errors } = await validateDto(VALID);
    expect(errors).toHaveLength(0);
  });

  it('rejects a whitespace-only name after trimming', async () => {
    const { errors } = await validateDto({ ...VALID, name: '   ' });
    expect(errors.some((e) => e.property === 'name')).toBe(true);
  });

  it('trims a valid name', async () => {
    const { dto } = await validateDto({ ...VALID, name: '  Paracetamol  ' });
    expect(dto.name).toBe('Paracetamol');
  });

  it('treats a whitespace-only sku as absent rather than a literal empty string', async () => {
    const { dto, errors } = await validateDto({ ...VALID, sku: '   ' });
    expect(errors).toHaveLength(0);
    expect(dto.sku).toBeUndefined();
  });

  it('trims a provided sku', async () => {
    const { dto } = await validateDto({ ...VALID, sku: '  SKU-1  ' });
    expect(dto.sku).toBe('SKU-1');
  });

  it('rejects an unknown unit', async () => {
    const { errors } = await validateDto({ ...VALID, unit: 'kg' });
    expect(errors.some((e) => e.property === 'unit')).toBe(true);
  });

  it('rejects a non-positive currentPrice', async () => {
    const { errors } = await validateDto({ ...VALID, currentPrice: 0 });
    expect(errors.some((e) => e.property === 'currentPrice')).toBe(true);
  });

  it('rejects a currentPrice with more than 2 decimal places', async () => {
    const { errors } = await validateDto({ ...VALID, currentPrice: 1.123 });
    expect(errors.some((e) => e.property === 'currentPrice')).toBe(true);
  });

  it('rejects a negative reorderThreshold', async () => {
    const { errors } = await validateDto({ ...VALID, reorderThreshold: -1 });
    expect(errors.some((e) => e.property === 'reorderThreshold')).toBe(true);
  });
});
