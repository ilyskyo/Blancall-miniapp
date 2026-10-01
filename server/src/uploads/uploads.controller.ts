import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../common/decorators';
import type { AuthUser } from '../common/types';
import { AVATAR_MAX_BYTES, DOC_MAX_BYTES, FONT_MAX_BYTES, UploadsService } from './uploads.service';

/** 文档上传 / 列表 / 删除 / 解析 */
@Controller('uploads/documents')
export class DocumentsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: DOC_MAX_BYTES } }))
  async upload(@CurrentUser() user: AuthUser, @UploadedFile() file?: Express.Multer.File) {
    return this.uploads.uploadDocument(user.id, user.openid, file);
  }

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    return this.uploads.listDocuments(user.id);
  }

  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.uploads.deleteDocument(user.id, id);
  }

  @Post(':id/parse')
  async parse(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.uploads.parseDocument(user.id, user.openid, id);
  }
}

/**
 * 头像上传转存：POST /uploads/avatar
 * 小程序头像昵称填写得到的是临时路径，必须先转存到对象存储，再把返回 URL 写入 PATCH /me
 */
@Controller('uploads')
export class AvatarController {
  constructor(private readonly uploads: UploadsService) {}

  @Post('avatar')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: AVATAR_MAX_BYTES } }))
  async upload(@CurrentUser() user: AuthUser, @UploadedFile() file?: Express.Multer.File) {
    return this.uploads.uploadAvatar(user.id, file);
  }
}

/**
 * 字体上传 / 列表 / 删除
 * 路由按接口规范为 POST /uploads/fonts、GET /fonts、DELETE /fonts/:id
 */
@Controller()
export class FontsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post('uploads/fonts')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: FONT_MAX_BYTES } }))
  async upload(@CurrentUser() user: AuthUser, @UploadedFile() file?: Express.Multer.File) {
    return this.uploads.uploadFont(user.id, file);
  }

  @Get('fonts')
  async list(@CurrentUser() user: AuthUser) {
    return this.uploads.listFonts(user.id);
  }

  @Delete('fonts/:id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.uploads.deleteFont(user.id, id);
  }
}