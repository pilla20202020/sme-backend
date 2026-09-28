import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

@Injectable()
export class ParseBase64IdPipe implements PipeTransform<string, number> {
  transform(value: string): number {
    try {
      const decoded = Buffer.from(value, 'base64').toString('utf-8');
      const id = parseInt(decoded, 10);
      if (isNaN(id) || id <= 0) throw new Error('invalid');
      return id;
    } catch {
      throw new BadRequestException('Invalid ID encoding');
    }
  }
}
