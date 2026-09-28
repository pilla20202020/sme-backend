import { IsNumber, IsPositive } from 'class-validator';

export class UpdatePriceDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  price!: number;
}
