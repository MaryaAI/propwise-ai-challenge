import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';

export class CreateRunDto {
  @IsOptional()
  @IsUUID()
  messageId?: string;
}

export class ChatMessageDto {
  @IsString()
  @Length(1, 2000)
  content: string;
}

export class ListRunsQuery {
  // The default lives in the service (`limit ?? 20`), matching ListLeadsQuery.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
