import { Controller, Get, Param } from '@nestjs/common';
import { Public } from '../common/decorators';
import { LibraryService } from './library.service';

/** 素材库（gaokao 文本）：对游客开放（免费功能，A1） */
@Public()
@Controller('library/gaokao')
export class LibraryController {
  constructor(private readonly library: LibraryService) {}

  /** GET /library/gaokao/index → [{no, title}] */
  @Get('index')
  async index() {
    return this.library.index();
  }

  /** GET /library/gaokao/:no → {no, title, text}（仅文本，不含 PDF） */
  @Get(':no')
  async get(@Param('no') no: string) {
    return this.library.get(no);
  }
}