import { IsOptional, IsUUID } from 'class-validator';

export class CreateRunDto {
  @IsOptional()
  @IsUUID()
  messageId?: string;
}
