import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard, AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { FilesService, CreateUploadIntentDto } from './files.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post('uploads/intent')
  @HttpCode(HttpStatus.OK)
  createIntent(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateUploadIntentDto,
  ) {
    return this.filesService.createIntent(req.user.sub, dto);
  }

  @Post('uploads/commit')
  @HttpCode(HttpStatus.OK)
  commitUpload(
    @Req() req: AuthenticatedRequest,
    @Body() body: { fileId: string },
  ) {
    return this.filesService.commitUpload(req.user.sub, body.fileId);
  }

  @Get('uploads/:id/parts')
  getMultipartParts(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.filesService.getMultipartParts(req.user.sub, id);
  }

  @Post('uploads/:id/complete')
  @HttpCode(HttpStatus.OK)
  completeMultipart(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.filesService.completeMultipart(req.user.sub, id);
  }

  @Get('files/:id')
  async downloadFile(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const presignedUrl = await this.filesService.getDownloadRedirectUrl(
      req.user.sub,
      req.user.role,
      id,
    );
    return res.redirect(HttpStatus.FOUND, presignedUrl);
  }
}
