import { IsNotEmpty, IsString } from 'class-validator';

// Deliberately just `IsString`/`IsNotEmpty` here (not `IsDateString`, which
// accepts full ISO8601 datetimes) — CashService.getDaily() does its own
// strict YYYY-MM-DD + calendar-validity check and throws the PRD's required
// 400 itself, so both "missing" (caught here) and "malformed" (caught in
// the service) end up as the same 400 the caller sees either way.
export class DailyCashQueryDto {
  @IsString()
  @IsNotEmpty({ message: 'date is required' })
  date!: string;
}
