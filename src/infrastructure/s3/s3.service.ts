import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

@Injectable()
export class S3Service {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly baseUrl: string;
  private readonly logger = new Logger(S3Service.name);

  constructor(private readonly configService: ConfigService) {
    this.client = new S3Client({
      region: this.configService.getOrThrow<string>('AWS_REGION'),
    });
    this.bucket = this.configService.getOrThrow<string>('AWS_S3_BUCKET');
    this.baseUrl = this.configService.getOrThrow<string>('AWS_S3_URL');
  }

  /**
   * Uploads a buffer to S3 under the given key.
   * Returns the public S3 URL of the uploaded file.
   */
  async uploadFile(
    key: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<string> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      }),
    );

    const url = `${this.baseUrl.replace(/\/$/, '')}/${key}`;
    this.logger.log(`File uploaded to S3: ${url}`);
    return url;
  }

  /**
   * Generates a time-limited signed URL for downloading a file from S3.
   */
  async getSignedDownloadUrl(
    key: string,
    fileName: string,
    expiresInSeconds = 900,
  ): Promise<string> {
    const safeFileName = fileName.replace(/["\r\n]/g, '');

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentDisposition: `attachment; filename="${safeFileName}"`,
    });

    return getSignedUrl(this.client, command, {
      expiresIn: expiresInSeconds,
    });
  }
}
