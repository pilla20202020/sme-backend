import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ReturnLineInputDto } from './return-line-input.dto';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : (value as string);

export class CreateReturnDto {
  // Its absence (not a special sentinel value) is what selects the
  // manager-override branch (PRD §5) — never coerced from an empty string.
  @IsOptional()
  @IsInt()
  saleId?: number;

  // Trimmed before the emptiness check — same convention as
  // CreateInventoryAdjustmentDto.reason (STORY-016).
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'reason must not be empty' })
  @MaxLength(2000)
  reason!: string;

  // Required only for the override branch (saleId omitted) — enforced here,
  // at the DTO layer, so a request with neither saleId nor
  // overrideApprovedBy fails with a plain 400 before the controller (and
  // therefore the service's stricter returns:override permission check)
  // ever runs (PRD STORY-024 AC).
  @ValidateIf((o: CreateReturnDto) => o.saleId == null)
  @IsInt()
  overrideApprovedBy?: number;

  @IsArray()
  @ArrayMinSize(1, { message: 'lines must contain at least 1 element' })
  @ValidateNested({ each: true })
  @Type(() => ReturnLineInputDto)
  lines!: ReturnLineInputDto[];
}
