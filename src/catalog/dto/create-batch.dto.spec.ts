import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateBatchDto } from './create-batch.dto';

async function validateDto(payload: Record<string, unknown>) {
  const dto = plainToInstance(CreateBatchDto, payload);
  const errors = await validate(dto);
  return { dto, errors };
}

describe('CreateBatchDto', () => {
  const VALID = {
    batchNumber: 'BN-001',
    expiryDate: '2030-01-01',
    quantityReceived: 100,
  };

  it('accepts a valid payload', async () => {
    const { errors } = await validateDto(VALID);
    expect(errors).toHaveLength(0);
  });

  it('trims batchNumber', async () => {
    const { dto } = await validateDto({ ...VALID, batchNumber: '  BN-001  ' });
    expect(dto.batchNumber).toBe('BN-001');
  });

  it('rejects a non-date-string expiryDate', async () => {
    const { errors } = await validateDto({
      ...VALID,
      expiryDate: 'not-a-date',
    });
    expect(errors.some((e) => e.property === 'expiryDate')).toBe(true);
  });

  it('rejects a quantityReceived below 1', async () => {
    const { errors } = await validateDto({ ...VALID, quantityReceived: 0 });
    expect(errors.some((e) => e.property === 'quantityReceived')).toBe(true);
  });
});
