import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  HttpCode,
  HttpStatus,
  ValidationPipe,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { MediaService } from './media.service';
import { CreateMediaDto } from './dto/create-media.dto';
import { UpdateMediaDto } from './dto/update-media.dto';
import { QueryMediaDto } from './dto/query-media.dto';
import { MediaEntity } from './entities/media.entity';
import { PaginatedResponseDto } from '../common/dto/paginated-response.dto';

@ApiTags('Media')
@Controller('media')
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Post('upload')
  @ApiOperation({
    summary: 'Upload a file and create media record',
    description: 'Uploads a file to S3 and creates a media record in the database',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'mediaType'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'File to upload',
        },
        mediaType: {
          type: 'string',
          enum: ['image', 'video', 'document'],
          description: 'Type of media',
        },
        category: {
          type: 'string',
          enum: ['exterior', 'interior', 'engine', 'document', 'receipt', 'title', 'other'],
          description: 'Category of media',
        },
        title: {
          type: 'string',
          description: 'Title of the media',
        },
        description: {
          type: 'string',
          description: 'Description of the media',
        },
        alt: {
          type: 'string',
          description: 'Alt text for images',
        },
        vehicleId: {
          type: 'string',
          format: 'uuid',
          description: 'Vehicle UUID to associate with',
        },
        isPublic: {
          type: 'boolean',
          description: 'Whether the media is public',
          default: true,
        },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'File uploaded and media record created successfully',
    type: MediaEntity,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid input data or no file provided',
  })
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() createMediaDto: CreateMediaDto,
  ): Promise<MediaEntity> {
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    return this.mediaService.uploadAndCreate(file, createMediaDto);
  }

  @Get()
  @ApiOperation({
    summary: 'Get all media with pagination and filters',
    description: 'Retrieves a paginated list of media files with optional filters',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number (default: 1)',
    example: 1,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Items per page (default: 10, max: 100)',
    example: 10,
  })
  @ApiQuery({
    name: 'vehicleId',
    required: false,
    type: String,
    description: 'Filter by vehicle UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiQuery({
    name: 'mediaType',
    required: false,
    enum: ['image', 'video', 'document'],
    description: 'Filter by media type',
  })
  @ApiQuery({
    name: 'category',
    required: false,
    enum: ['exterior', 'interior', 'engine', 'document', 'receipt', 'title', 'other'],
    description: 'Filter by category',
  })
  @ApiQuery({
    name: 'isActive',
    required: false,
    type: Boolean,
    description: 'Filter by active status',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Successfully retrieved media files',
    type: PaginatedResponseDto<MediaEntity>,
  })
  async findAll(
    @Query(ValidationPipe) query: QueryMediaDto,
  ): Promise<PaginatedResponseDto<MediaEntity>> {
    return this.mediaService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a media file by ID',
    description: 'Retrieves a single media file by its UUID',
  })
  @ApiParam({
    name: 'id',
    description: 'Media UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Media file found',
    type: MediaEntity,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Media file not found',
  })
  async findOne(@Param('id') id: string): Promise<MediaEntity> {
    return this.mediaService.findOne(id);
  }

  @Get(':id/signed-url')
  @ApiOperation({
    summary: 'Get a signed URL for private media',
    description: 'Generates a temporary signed URL for accessing private media files',
  })
  @ApiParam({
    name: 'id',
    description: 'Media UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiQuery({
    name: 'expiresIn',
    required: false,
    type: Number,
    description: 'URL expiration time in seconds (default: 3600)',
    example: 3600,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Signed URL generated successfully',
    schema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          example: 'https://bucket.s3.amazonaws.com/key?signature=...',
        },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Media file not found',
  })
  async getSignedUrl(
    @Param('id') id: string,
    @Query('expiresIn') expiresIn?: number,
  ): Promise<{ url: string }> {
    return this.mediaService.getSignedUrl(id, expiresIn);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update a media record',
    description: 'Updates metadata of an existing media record. File itself cannot be updated.',
  })
  @ApiParam({
    name: 'id',
    description: 'Media UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Media record successfully updated',
    type: MediaEntity,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid input data',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Media file not found',
  })
  async update(
    @Param('id') id: string,
    @Body(ValidationPipe) updateMediaDto: UpdateMediaDto,
  ): Promise<MediaEntity> {
    return this.mediaService.update(id, updateMediaDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete a media file',
    description: 'Deletes a media file from both S3 and the database',
  })
  @ApiParam({
    name: 'id',
    description: 'Media UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Media file successfully deleted',
    schema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          example: 'Media with ID xxx has been successfully deleted',
        },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Media file not found',
  })
  async remove(@Param('id') id: string): Promise<{ message: string }> {
    return this.mediaService.remove(id);
  }
}
