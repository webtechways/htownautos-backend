import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UploadSessionService } from './upload-session.service';
import { CreateUploadSessionDto } from './dto/create-upload-session.dto';

@ApiTags('Upload Sessions')
@ApiBearerAuth()
@Controller('upload-sessions')
export class UploadSessionController {
  constructor(private readonly uploadSessionService: UploadSessionService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new upload session for phone uploads' })
  async create(
    @Body() dto: CreateUploadSessionDto,
    @Req() req: any,
  ) {
    const userId = req.user?.id;
    const tenantId = req.user?.tenants?.[0]?.tenantId;
    return this.uploadSessionService.create(dto, userId, tenantId);
  }

  @Get(':token/media')
  @ApiOperation({ summary: 'Poll for media uploaded via this session' })
  async getSessionMedia(@Param('token') token: string) {
    return this.uploadSessionService.getSessionMedia(token);
  }

  @Delete(':token')
  @ApiOperation({ summary: 'Close/invalidate an upload session' })
  async close(@Param('token') token: string, @Req() req: any) {
    const userId = req.user?.id;
    return this.uploadSessionService.close(token, userId);
  }
}
