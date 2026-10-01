import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { DocumentParserService } from './document-parser.service';
import { FontParserService } from './font-parser.service';
import { DocumentsController, FontsController, AvatarController } from './uploads.controller';
import { UploadsService } from './uploads.service';

@Module({
  imports: [StorageModule],
  controllers: [DocumentsController, FontsController, AvatarController],
  providers: [UploadsService, DocumentParserService, FontParserService],
  exports: [UploadsService],
})
export class UploadsModule {}