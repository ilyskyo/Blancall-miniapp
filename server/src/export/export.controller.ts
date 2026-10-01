import { Body, Controller, Post } from '@nestjs/common';
import { CurrentUser } from '../common/decorators';
import type { AuthUser } from '../common/types';
import { parseZod } from '../common/zod.util';
import { csvSchema, pdfSchema, type CsvBody, type PdfBody } from './export.dto';
import { ExportService } from './export.service';

@Controller('export')
export class ExportController {
  constructor(private readonly exporter: ExportService) {}

  /** POST /export/csv → {fileUrl, expireAt} */
  @Post('csv')
  async csv(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const dto: CsvBody = parseZod(csvSchema, body ?? {});
    return this.exporter.csv(user.id, dto);
  }

  /** POST /export/pdf → {fileUrl, expireAt} */
  @Post('pdf')
  async pdf(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const dto: PdfBody = parseZod(pdfSchema, body);
    return this.exporter.pdf(user.id, dto);
  }

  /** POST /export/backup → {fileUrl, expireAt}（个人数据备份 JSON） */
  @Post('backup')
  async backup(@CurrentUser() user: AuthUser) {
    return this.exporter.backup(user.id);
  }
}