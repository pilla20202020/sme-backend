import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateSupplierDto } from './create-supplier.dto';

async function validateDto(payload: Record<string, unknown>) {
  const dto = plainToInstance(CreateSupplierDto, payload);
  const errors = await validate(dto);
  return { dto, errors };
}

describe('CreateSupplierDto', () => {
  it('rejects a whitespace-only name after trimming', async () => {
    const { errors } = await validateDto({ name: '  ' });

    expect(errors.some((e) => e.property === 'name')).toBe(true);
  });

  it('trims leading/trailing whitespace from a valid name', async () => {
    const { dto, errors } = await validateDto({ name: '  Acme Pharma  ' });

    expect(errors).toHaveLength(0);
    expect(dto.name).toBe('Acme Pharma');
  });

  it('accepts a name with no optional fields', async () => {
    const { errors } = await validateDto({ name: 'Acme Pharma' });

    expect(errors).toHaveLength(0);
  });

  it('trims a provided contactPerson and paymentTerms', async () => {
    const { dto, errors } = await validateDto({
      name: 'Acme Pharma',
      contactPerson: '  John Smith  ',
      paymentTerms: '  Net 30  ',
    });

    expect(errors).toHaveLength(0);
    expect(dto.contactPerson).toBe('John Smith');
    expect(dto.paymentTerms).toBe('Net 30');
  });

  it('rejects an invalid email', async () => {
    const { errors } = await validateDto({
      name: 'Acme Pharma',
      email: 'not-an-email',
    });

    expect(errors.some((e) => e.property === 'email')).toBe(true);
  });

  it('trims a provided address', async () => {
    const { dto, errors } = await validateDto({
      name: 'Acme Pharma',
      address: '  789 Industrial Rd  ',
    });

    expect(errors).toHaveLength(0);
    expect(dto.address).toBe('789 Industrial Rd');
  });
});
