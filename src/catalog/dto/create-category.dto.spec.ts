import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateCategoryDto } from './create-category.dto';

async function validateDto(payload: Record<string, unknown>) {
  const dto = plainToInstance(CreateCategoryDto, payload);
  const errors = await validate(dto);
  return { dto, errors };
}

describe('CreateCategoryDto', () => {
  it('rejects a whitespace-only name after trimming', async () => {
    const { errors } = await validateDto({ name: '   ' });

    expect(errors.some((e) => e.property === 'name')).toBe(true);
  });

  it('trims leading/trailing whitespace from a valid name', async () => {
    const { dto, errors } = await validateDto({ name: '  Tablets  ' });

    expect(errors).toHaveLength(0);
    expect(dto.name).toBe('Tablets');
  });

  it('rejects a name longer than 150 characters', async () => {
    const { errors } = await validateDto({ name: 'a'.repeat(151) });

    expect(errors.some((e) => e.property === 'name')).toBe(true);
  });
});
