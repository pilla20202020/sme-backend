import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateCustomerDto } from './create-customer.dto';

async function validateDto(payload: Record<string, unknown>) {
  const dto = plainToInstance(CreateCustomerDto, payload);
  const errors = await validate(dto);
  return { dto, errors };
}

describe('CreateCustomerDto', () => {
  it('rejects a whitespace-only name after trimming', async () => {
    const { errors } = await validateDto({ name: '  ' });

    expect(errors.some((e) => e.property === 'name')).toBe(true);
  });

  it('trims leading/trailing whitespace from a valid name', async () => {
    const { dto, errors } = await validateDto({ name: '  Jane Doe  ' });

    expect(errors).toHaveLength(0);
    expect(dto.name).toBe('Jane Doe');
  });

  it('accepts a name with no optional fields', async () => {
    const { errors } = await validateDto({ name: 'Jane Doe' });

    expect(errors).toHaveLength(0);
  });

  it('trims a provided phone', async () => {
    const { dto, errors } = await validateDto({
      name: 'Jane Doe',
      phone: '  555-0101  ',
    });

    expect(errors).toHaveLength(0);
    expect(dto.phone).toBe('555-0101');
  });

  it('rejects an invalid email', async () => {
    const { errors } = await validateDto({
      name: 'Jane Doe',
      email: 'not-an-email',
    });

    expect(errors.some((e) => e.property === 'email')).toBe(true);
  });

  it('trims a provided address', async () => {
    const { dto, errors } = await validateDto({
      name: 'Jane Doe',
      address: '  456 Elm St  ',
    });

    expect(errors).toHaveLength(0);
    expect(dto.address).toBe('456 Elm St');
  });
});
