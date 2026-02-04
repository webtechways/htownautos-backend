import {
  Controller,
  Get,
  Param,
  Query,
  ValidationPipe,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AuditLogService } from './audit-log.service';
import { QueryAuditLogDto } from './dto/query-audit-log.dto';

@ApiTags('Audit Logs')
@Controller('audit-logs')
export class AuditLogController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @Get()
  @ApiOperation({ summary: 'Query audit logs with filters' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Paginated audit logs' })
  findAll(@Query(ValidationPipe) query: QueryAuditLogDto) {
    return this.auditLogService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single audit log entry' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Audit log entry' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Audit log not found' })
  findOne(@Param('id') id: string) {
    return this.auditLogService.findOne(id);
  }
}
