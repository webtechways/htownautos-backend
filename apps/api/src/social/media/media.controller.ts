import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentTenant, CurrentUser, RequireApiScopes, type AuthenticatedUser } from '@htownautos/auth';
import { PaginationDto } from '@htownautos/common';
import { SocialMediaService } from './media.service';
import { MediaUploadUrlDto, RegisterMediaDto, PatchMediaDto } from './dto';

@ApiTags('social-media')
@ApiBearerAuth()
@Controller('social/media')
export class SocialMediaController {
  constructor(private readonly service: SocialMediaService) {}

  @Post('upload-url')
  @RequireApiScopes('social:write')
  @ApiOperation({ summary: 'Presigned PUT URL for a new media object (private bucket)' })
  createUploadUrl(@CurrentTenant() tenantId: string, @Body() dto: MediaUploadUrlDto) {
    return this.service.createUploadUrl(tenantId, dto);
  }

  @Post()
  @RequireApiScopes('social:write')
  @ApiOperation({ summary: 'Register a media object after the presigned PUT succeeded' })
  register(@CurrentTenant() tenantId: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: RegisterMediaDto) {
    return this.service.register(tenantId, user?.id ?? null, dto);
  }

  @Get()
  @RequireApiScopes('social:read')
  @ApiOperation({ summary: 'List the tenant media library' })
  list(@CurrentTenant() tenantId: string, @Query() query: PaginationDto) {
    return this.service.list(tenantId, query.page ?? 1, query.limit ?? 20);
  }

  @Patch(':id')
  @RequireApiScopes('social:write')
  @ApiOperation({ summary: 'Update alt text' })
  patch(@CurrentTenant() tenantId: string, @Param('id') id: string, @Body() dto: PatchMediaDto) {
    return this.service.patchAltText(tenantId, id, dto.altText);
  }

  @Delete(':id')
  @RequireApiScopes('social:write')
  @ApiOperation({ summary: 'Delete a media object (409 if a not-yet-published post/idea uses it)' })
  remove(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.service.remove(tenantId, id);
  }
}
