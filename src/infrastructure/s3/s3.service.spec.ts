import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { S3Service } from './s3.service';

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn(),
}));

const makeConfigService = () => ({
  getOrThrow: jest.fn((key: string) => {
    const values: Record<string, string> = {
      AWS_REGION: 'us-east-2',
      AWS_S3_BUCKET: 'test-bucket',
      AWS_S3_URL: 'https://test-bucket.s3.us-east-2.amazonaws.com',
    };
    return values[key];
  }),
});

describe('S3Service', () => {
  let sendSpy: jest.SpyInstance;

  beforeEach(() => {
    sendSpy = jest
      .spyOn(S3Client.prototype, 'send')
      .mockResolvedValue({} as never);
    (getSignedUrl as jest.Mock).mockClear();
  });

  afterEach(() => {
    sendSpy.mockRestore();
  });

  describe('uploadFile', () => {
    it('uploads a buffer under the given key and content type', async () => {
      const service = new S3Service(makeConfigService() as never);

      const url = await service.uploadFile(
        'tenants/1/catalog-import-9.csv',
        Buffer.from('a,b,c'),
        'text/csv',
      );

      expect(sendSpy).toHaveBeenCalledTimes(1);
      const [command] = sendSpy.mock.calls[0] as [
        { input: { Key: string; Bucket: string; ContentType: string } },
      ];
      expect(command.input.Key).toBe('tenants/1/catalog-import-9.csv');
      expect(command.input.Bucket).toBe('test-bucket');
      expect(command.input.ContentType).toBe('text/csv');
      expect(url).toBe(
        'https://test-bucket.s3.us-east-2.amazonaws.com/tenants/1/catalog-import-9.csv',
      );
    });
  });

  describe('getSignedDownloadUrl', () => {
    it('signs a GetObjectCommand forcing a download with the given filename', async () => {
      (getSignedUrl as jest.Mock).mockResolvedValue(
        'https://signed.example.com/download',
      );
      const service = new S3Service(makeConfigService() as never);

      const url = await service.getSignedDownloadUrl(
        'tenants/1/reports/sales-2026-08.csv',
        'sales-2026-08.csv',
      );

      expect(url).toBe('https://signed.example.com/download');
      expect(getSignedUrl).toHaveBeenCalledTimes(1);

      const [, command, options] = (getSignedUrl as jest.Mock).mock
        .calls[0] as [S3Client, GetObjectCommand, { expiresIn: number }];
      expect(command.input.Bucket).toBe('test-bucket');
      expect(command.input.Key).toBe('tenants/1/reports/sales-2026-08.csv');
      expect(command.input.ResponseContentDisposition).toBe(
        'attachment; filename="sales-2026-08.csv"',
      );
      expect(options.expiresIn).toBe(900);
    });

    it('strips quotes and newlines from the filename used in the Content-Disposition header', async () => {
      (getSignedUrl as jest.Mock).mockResolvedValue(
        'https://signed.example.com/download',
      );
      const service = new S3Service(makeConfigService() as never);

      await service.getSignedDownloadUrl(
        'tenants/1/reports/evil.csv',
        'evil".csv\r\nX-Injected: 1',
      );

      const [, command] = (getSignedUrl as jest.Mock).mock.calls[0] as [
        S3Client,
        GetObjectCommand,
      ];
      expect(command.input.ResponseContentDisposition).toBe(
        'attachment; filename="evil.csvX-Injected: 1"',
      );
    });
  });
});
