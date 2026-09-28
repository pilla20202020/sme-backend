import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdatePriceDto } from './update-price.dto';

async function validateDto(payload: Record<string, unknown>) {
  const dto = plainToInstance(UpdatePriceDto, payload);
  const errors = await validate(dto);
  return { dto, errors };
}

describe('UpdatePriceDto', () => {
  it('accepts a valid positive price', async () => {
    const { errors } = await validateDto({ price: 4.99 });
    expect(errors).toHaveLength(0);
  });

  it('rejects a zero or negative price', async () => {
    const { errors } = await validateDto({ price: 0 });
    expect(errors.some((e) => e.property === 'price')).toBe(true);
  });

  it('rejects a price with more than 2 decimal places', async () => {
    const { errors } = await validateDto({ price: 4.999 });
    expect(errors.some((e) => e.property === 'price')).toBe(true);
  });
});
