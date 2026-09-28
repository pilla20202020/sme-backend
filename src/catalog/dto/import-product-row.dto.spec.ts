import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ImportProductRowDto } from './import-product-row.dto';

async function validateDto(payload: Record<string, unknown>) {
  const dto = plainToInstance(ImportProductRowDto, payload);
  const errors = await validate(dto);
  return { dto, errors };
}

describe('ImportProductRowDto', () => {
  const VALID = { name: 'Product A', unit: 'tablet', currentPrice: 1 };

  it('accepts a minimal valid row', async () => {
    const { errors } = await validateDto(VALID);
    expect(errors).toHaveLength(0);
  });

  it('rejects a missing name', async () => {
    const { errors } = await validateDto({ ...VALID, name: undefined });
    expect(errors.some((e) => e.property === 'name')).toBe(true);
  });

  it('treats a blank categoryName as absent', async () => {
    const { dto, errors } = await validateDto({
      ...VALID,
      categoryName: '   ',
    });
    expect(errors).toHaveLength(0);
    expect(dto.categoryName).toBeUndefined();
  });

  it('trims a provided categoryName', async () => {
    const { dto } = await validateDto({
      ...VALID,
      categoryName: '  Tablets  ',
    });
    expect(dto.categoryName).toBe('Tablets');
  });

  it('rejects an unknown unit', async () => {
    const { errors } = await validateDto({ ...VALID, unit: 'kg' });
    expect(errors.some((e) => e.property === 'unit')).toBe(true);
  });
});
